import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, RESPONSE_INIT } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ResolveFn, RouterLink } from '@angular/router';
import { CatalogApi, ProductDetail as ProductDetailData, slugSegment, StoreSettings } from './catalog-api';
import { LanguageService } from './language';
import { compareGarmentSizes, sortGarmentSizes } from '../../../shared/garment-sizes';

export type ProductDetailPageData =
  | { status: 'success'; product: ProductDetailData; settings: StoreSettings | null }
  | { status: 'not-found' | 'error' };

type Variant = ProductDetailData['variants'][number];

function variantAttributes(variant: Variant): { label: string; value: string }[] {
  if (!variant.attributesJson) return [];
  try {
    const attributes: unknown = JSON.parse(variant.attributesJson);
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return [];
    return Object.entries(attributes).flatMap(([rawLabel, rawValue]) => {
      const label = rawLabel.trim();
      const value = typeof rawValue === 'string' || typeof rawValue === 'number' && Number.isFinite(rawValue) ? String(rawValue).trim() : '';
      return label && value ? [{ label, value }] : [];
    });
  } catch { return []; }
}

export function variantLabel(variant: Variant): string {
  const attributes = variantAttributes(variant);
  return attributes.length ? attributes.map(({ label, value }) => `${label}: ${value}`).join(' / ') : variant.name;
}

export function sortVariants(variants: readonly Variant[]): Variant[] {
  return [...variants].sort((a, b) => {
    const sizeA = variantAttributes(a).find(attribute => attribute.label.toLocaleLowerCase() === 'size')?.value;
    const sizeB = variantAttributes(b).find(attribute => attribute.label.toLocaleLowerCase() === 'size')?.value;
    if (!sizeA || !sizeB) return sizeA ? -1 : sizeB ? 1 : 0;
    return compareGarmentSizes(sizeA, sizeB);
  });
}

export function variantDimensions(variants: readonly Variant[]): { label: string; values: string[] }[] {
  const dimensions = new Map<string, { label: string; values: string[]; seen: Set<string> }>();
  for (const variant of variants) {
    for (const { label, value } of variantAttributes(variant)) {
      const key = label.toLocaleLowerCase();
      const dimension = dimensions.get(key) ?? { label: label[0].toLocaleUpperCase() + label.slice(1), values: [], seen: new Set<string>() };
      if (!dimension.seen.has(value.toLocaleLowerCase())) { dimension.seen.add(value.toLocaleLowerCase()); dimension.values.push(value); }
      dimensions.set(key, dimension);
    }
  }
  return [...dimensions.entries()].map(([key, { label, values }]) => ({ label, values: key === 'size' ? sortGarmentSizes(values) : values }));
}

// Route: /products/:slug, resolve: { productDetail: resolveProductDetail }.
export const resolveProductDetail: ResolveFn<ProductDetailPageData> = async route => {
  const api = inject(CatalogApi);
  const response = inject(RESPONSE_INIT, { optional: true });
  const slug = route.paramMap.get('slug');
  try { if (slug) slugSegment(slug); } catch {
    if (response && response.status !== 500) response.status = 404;
    return { status: 'not-found' };
  }
  try {
    const product = slug ? await api.product(slug) : null;
    if (!product) {
      if (response && response.status !== 500) response.status = 404;
      return { status: 'not-found' };
    }
    const settings = await api.storeSettings();
    return { status: 'success', product, settings };
  } catch {
    if (response) response.status = 500;
    return { status: 'error' };
  }
};

function safeImage(value: string): boolean {
  return /^\/(?![\/\\])/.test(value) || /^https?:\/\//i.test(value) && safeLink(value) !== null;
}

function safeLink(value: string | null): string | null {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.css',
})
export class ProductDetail {
  readonly language = inject(LanguageService);
  private readonly route = inject(ActivatedRoute);
  private readonly data = toSignal(this.route.data, { initialValue: this.route.snapshot.data });
  readonly detail = computed(() => this.data()['productDetail'] as ProductDetailPageData);
  readonly product = computed(() => { const detail = this.detail(); return detail?.status === 'success' ? detail.product : null; });
  private readonly identity = computed(() => this.product()?.id ?? null);
  readonly failedImages = linkedSignal<string | null, readonly string[]>({ source: this.identity, computation: () => [] });
  readonly selectedVariant = linkedSignal<string | null, string | null>({ source: this.identity, computation: () => null });
  readonly selectedImage = linkedSignal({ source: () => [this.identity(), this.selectedVariant()] as const, computation: (): string | null => null });
  readonly copyStatus = linkedSignal<string | null, string>({ source: this.identity, computation: () => '' });
  readonly images = computed(() => (this.variant()?.images ?? this.product()?.images ?? []).filter(image => safeImage(image.url) && !this.failedImages().includes(image.url)));
  readonly image = computed(() => this.images().find(image => image.id === this.selectedImage()) ?? this.images()[0] ?? null);
  readonly variant = computed(() => this.product()?.variants.find(variant => variant.id === this.selectedVariant()) ?? null);
  readonly sortedVariants = computed(() => sortVariants(this.product()?.variants ?? []));
  readonly variantLabel = variantLabel;
  readonly variantDimensions = computed(() => variantDimensions(this.product()?.variants ?? []));
  readonly price = computed(() => {
    const product = this.product();
    if (!product) return null;
    const amount = this.variant()?.priceMinor ?? product.priceMinor;
    if (product.currency.toUpperCase() !== 'VND' || amount === null || !Number.isSafeInteger(amount) || amount < 0) return null;
    return this.language.formatPrice(amount);
  });
  readonly contacts = computed(() => {
    const detail = this.detail();
    const settings = detail?.status === 'success' ? detail.settings : null;
    if (!settings) return [];
    const labels = this.language.text();
    return ([[labels.zalo, settings.zaloUrl], [labels.instagram, settings.instagramUrl], [labels.messenger, settings.messengerUrl], [labels.tikTok, settings.tiktokUrl], [labels.otherContact, settings.otherContactUrl]] as const)
      .flatMap(([label, value]) => { const url = safeLink(value); return url ? [{ label, url }] : []; });
  });

  imageFailed(url: string): void { this.failedImages.update(images => [...images, url]); }

  inquiryText(): string {
    const product = this.product();
    if (!product) return '';
    const variant = this.variant();
    const introduction = this.language.current() === 'vi' ? 'Xin chào, tôi quan tâm đến sản phẩm' : "Hello, I'm interested in";
    return `${introduction} ${product.name}${variant ? ` — ${variantLabel(variant)}${variant.sku ? ` (${variant.sku})` : ''}` : ''}. ${typeof location === 'undefined' ? '' : location.href}`.trim();
  }

  messengerUrl(): string {
    return `https://m.me/thichmacdep3007?text=${encodeURIComponent(this.inquiryText())}`;
  }

  async copyInquiry(): Promise<void> {
    const product = this.product();
    if (!product) return;
    const text = this.inquiryText();
    try {
      await navigator.clipboard.writeText(text);
      if (this.identity() === product.id) this.copyStatus.set(this.language.text().copied);
    } catch { if (this.identity() === product.id) this.copyStatus.set(this.language.text().copyFailed); }
  }
}
