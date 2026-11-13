import { DOCUMENT, isPlatformServer } from '@angular/common';
import { inject, Injectable, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import type { CatalogPageData } from './catalog-page';
import type { ProductDetailPageData } from './product-detail';
import type { ShellData } from './storefront-shell';

const originKey = makeStateKey<string | null>('seo-site-origin');

// Only a configured origin is trusted; never derive it from the incoming URL.
function configuredOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

function imageUrl(value: string, origin: string | null): string | null {
  if (!value || value !== value.trim()) return null;
  if (value.startsWith('/') && (!origin || /^\/[\/\\]/.test(value))) return null;
  try {
    const url = new URL(value, origin ?? undefined);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

@Injectable()
export class SeoTitleStrategy extends TitleStrategy {
  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly state = inject(TransferState);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  private readonly context = inject(REQUEST_CONTEXT, { optional: true }) as { siteOrigin?: string } | null;
  private readonly origin = this.getOrigin();

  private getOrigin(): string | null {
    if (this.server) {
      const origin = configuredOrigin(this.context?.siteOrigin);
      this.state.set(originKey, origin);
      return origin;
    }
    return configuredOrigin(this.state.get(originKey, null));
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    let route = snapshot.root;
    let shellError = false;
    while (route.firstChild) {
      const shell = route.data['shellData'] as ShellData | undefined;
      shellError ||= !!shell?.error;
      route = route.firstChild;
    }
    const shell = route.data['shellData'] as ShellData | undefined;
    shellError ||= !!shell?.error;
    const catalog = route.data['catalog'] as CatalogPageData | undefined;
    const detail = route.data['productDetail'] as ProductDetailPageData | undefined;
    const filtered = Object.keys(route.queryParams).length > 0;
    let title = 'Thích Mặc Đẹp';
    let description = 'Explore the Thích Mặc Đẹp catalog.';
    let path: string | null = null;
    let index = false;
    if (!shellError && catalog?.status === 'success') {
      const home = route.routeConfig?.path === '';
      title = home ? 'Thích Mặc Đẹp | Home' : catalog.category ? `${catalog.category.name} | Thích Mặc Đẹp` : 'Products | Thích Mặc Đẹp';
      description = home ? 'Discover Thích Mặc Đẹp and explore our catalog.' : catalog.category ? `Explore ${catalog.category.name} at Thích Mặc Đẹp.` : 'Explore products at Thích Mặc Đẹp.';
      path = home ? '/' : catalog.category ? `/categories/${encodeURIComponent(catalog.category.slug)}` : '/products';
      index = !filtered;
    } else if (!shellError && detail?.status === 'success') {
      const product = detail.product;
      title = product.website.seoTitle?.trim() || `${product.name} | Thích Mặc Đẹp`;
      description = product.website.seoDescription?.trim() || product.shortDescription?.trim() || `Explore ${product.name} at Thích Mặc Đẹp.`;
      path = `/products/${encodeURIComponent(product.slug)}`;
      index = !filtered;
    }
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ name: 'robots', content: index ? 'index, follow' : 'noindex, follow' });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:type', content: detail?.status === 'success' && !shellError ? 'product' : 'website' });
    const images = detail?.status === 'success' && !shellError ? [...detail.product.images].sort((a, b) => a.position - b.position) : [];
    const image = images.map(item => imageUrl(item.url, this.origin)).find(Boolean) ?? imageUrl('/tmd-logo-cropped.png', this.origin);
    this.meta.updateTag({ name: 'twitter:card', content: image ? 'summary_large_image' : 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.removeTag('property="og:image"');
    this.meta.removeTag('name="twitter:image"');
    if (image) {
      this.meta.updateTag({ property: 'og:image', content: image });
      this.meta.updateTag({ name: 'twitter:image', content: image });
    }
    const canonical = index && path && this.origin ? `${this.origin}${path}` : null;
    this.document.head.querySelectorAll('link[rel="canonical"]').forEach(link => link.remove());
    this.meta.removeTag('property="og:url"');
    if (canonical) {
      const link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      link.setAttribute('href', canonical);
      this.document.head.appendChild(link);
      this.meta.updateTag({ property: 'og:url', content: canonical });
    }
  }
}
