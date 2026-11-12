import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ActivatedRouteSnapshot, convertToParamMap, provideRouter, RouterStateSnapshot } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { CatalogApi, ProductDetail as ProductData, StoreSettings } from './catalog-api';
import { ProductDetail, ProductDetailPageData, resolveProductDetail, sortVariants, variantDimensions, variantLabel } from './product-detail';
import { sortGarmentSizes } from '../../../shared/garment-sizes';

const product: ProductData = {
  id: 'p', sku: 'P-1', slug: 'synthetic', name: 'Synthetic garment', shortDescription: null, description: 'Actual description', brandName: null,
  priceMinor: 120000, currency: 'VND', website: { seoTitle: null, seoDescription: null, marketingDescription: null, isFeatured: false, displayOrder: 0 },
  images: [{ id: 'i', url: '/media/example.jpg', altText: null, position: 0 }],
  variants: [{ id: 'v', sku: 'V-1', name: 'Synthetic variant', attributesJson: null, priceMinor: 150000 }],
  categories: [{ id: 'c', slug: 'synthetic-category', name: 'Synthetic category', parentId: null }],
};
const settings: StoreSettings = { storeName: 'Synthetic store', defaultCurrency: 'VND', tiktokUrl: null, instagramUrl: 'javascript:alert(1)', zaloUrl: 'https://example.test/contact', messengerUrl: null, otherContactUrl: null, logoUrl: null };

describe('product detail resolver', () => {
  let response: ResponseInit;
  let api: { product: ReturnType<typeof vi.fn>; storeSettings: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    response = {};
    api = { product: vi.fn().mockResolvedValue(product), storeSettings: vi.fn().mockResolvedValue(settings) };
    TestBed.configureTestingModule({ providers: [{ provide: CatalogApi, useValue: api }, { provide: RESPONSE_INIT, useValue: response }] });
  });
  function resolve(slug = 'synthetic') {
    const route = { paramMap: convertToParamMap({ slug }) } as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() => resolveProductDetail(route, {} as RouterStateSnapshot)) as Promise<ProductDetailPageData>;
  }
  it('awaits product and optional settings', async () => {
    expect(await resolve()).toEqual({ status: 'success', product, settings });
    expect(api.product).toHaveBeenCalledWith('synthetic');
    api.storeSettings.mockRejectedValueOnce(new Error('offline'));
    expect(await resolve()).toEqual({ status: 'error' });
    expect(response.status).toBe(500);
  });
  it('sets SSR status for missing product and backend failure', async () => {
    api.product.mockResolvedValueOnce(null);
    expect((await resolve()).status).toBe('not-found');
    expect(response.status).toBe(404);
    api.product.mockRejectedValueOnce(new Error('offline'));
    expect((await resolve()).status).toBe('error');
    expect(response.status).toBe(500);
  });
  it('returns 404 for invalid slugs without contacting the API', async () => {
    expect((await resolve('bad%slug')).status).toBe('not-found');
    expect(response.status).toBe(404);
    expect(api.product).not.toHaveBeenCalled();
  });
});

describe('product detail page', () => {
  it('orders numeric equivalents with garment sizes and leaves unknown sizes last', () => {
    expect(sortGarmentSizes(['3XL', 'XXL', 'XL', '2XL', 'L', 'custom', 'M'])).toEqual(['M', 'L', 'XL', '2XL', 'XXL', '3XL', 'custom']);
  });
  it('validates attributes for labels and sorts selectable variants without mutation', () => {
    const base = product.variants[0];
    const variants = [
      { ...base, id: 'bad', attributesJson: '{' },
      { ...base, id: 'large', attributesJson: '{"size":"2XL","color":"Red","fabric":"Cotton"}' },
      { ...base, id: 'small', attributesJson: '{" SIZE ":" S ","color":"Blue","invalid":{},"empty":" "}' },
      { ...base, id: 'medium', attributesJson: '{"size":"M","color":"Red"}' },
      { ...base, id: 'array', attributesJson: '["S"]' },
    ];
    expect(sortVariants(variants).map(item => item.id)).toEqual(['small', 'medium', 'large', 'bad', 'array']);
    expect(variants[0].id).toBe('bad');
    expect(variantLabel(variants[1])).toBe('size: 2XL / color: Red / fabric: Cotton');
    expect(variantLabel(variants[2])).toBe('SIZE: S / color: Blue');
    expect(variantLabel(variants[0])).toBe(base.name);
    expect(variantLabel(variants[4])).toBe(base.name);
  });
  it('renders ordered selectable combinations and copies the selected attributes', async () => {
    const variants = ['L', 'S', 'M'].map((size, index) => ({ ...product.variants[0], id: size, sku: `SKU-${size}`, name: 'Same name', attributesJson: JSON.stringify({ size, color: ['Red', 'Blue', 'Black'][index] }) }));
    const detail: ProductDetailPageData = { status: 'success', product: { ...product, variants }, settings };
    const data = new BehaviorSubject({ productDetail: detail });
    TestBed.configureTestingModule({ imports: [ProductDetail], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { data, snapshot: { data: data.value } } }] });
    const fixture = TestBed.createComponent(ProductDetail);
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.variants button')) as HTMLButtonElement[];
    expect(buttons.map(button => button.textContent?.trim())).toEqual(['size: S / color: Blue', 'size: M / color: Black', 'size: L / color: Red']);
    buttons[0].click();
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('legend').textContent).toContain('size: S / color: Blue');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      await fixture.componentInstance.copyInquiry();
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('size: S / color: Blue (SKU-S)'));
    } finally { vi.unstubAllGlobals(); }
  });
  it('sorts sizes deterministically without mutating input', () => {
    const sizes = Object.freeze(['zeta', 'xxl', 'M', 'xs', 'L', 'S', 'XL', 'XXS', 'alpha', 'm']);
    expect(sortGarmentSizes(sizes)).toEqual(['XXS', 'xs', 'S', 'M', 'm', 'L', 'XL', 'xxl', 'alpha', 'zeta']);
    expect(sizes[0]).toBe('zeta');
    expect(sortGarmentSizes([...sizes].reverse())).toEqual(sortGarmentSizes(sizes));
  });
  it('sorts only size dimensions and retains other option order', () => {
    const variants = ['L', 'xs', 'unknown', 'M', 'S'].map((size, index) => ({
      id: String(index), sku: null, name: size, attributesJson: JSON.stringify({ SIZE: size, color: ['Red', 'Blue', 'Green', 'Black', 'White'][index] }), priceMinor: null,
    }));
    expect(variantDimensions(variants)).toEqual([
      { label: 'SIZE', values: ['xs', 'S', 'M', 'L', 'unknown'] },
      { label: 'Color', values: ['Red', 'Blue', 'Green', 'Black', 'White'] },
    ]);
    expect(JSON.parse(variants[0].attributesJson).SIZE).toBe('L');
  });
  it('renders ordered sizes and unchanged color order in the detail page', () => {
    const variants = ['L', 'xs', 'M', 'S', 'custom'].map((size, index) => ({
      id: String(index), sku: null, name: size, attributesJson: JSON.stringify({ size, color: ['Red', 'Blue', 'Green', 'Black', 'White'][index] }), priceMinor: null,
    }));
    const detail: ProductDetailPageData = { status: 'success', product: { ...product, variants }, settings };
    const data = new BehaviorSubject({ productDetail: detail });
    TestBed.configureTestingModule({ imports: [ProductDetail], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { data, snapshot: { data: data.value } } }] });
    const fixture = TestBed.createComponent(ProductDetail);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Size: xs, S, M, L, custom');
    expect(text).toContain('Color: Red, Blue, Green, Black, White');
  });
  it('renders persisted C54-style attributes as deduplicated dimension choices', () => {
    expect(variantDimensions([
      { id: 's', sku: 'C54-S', name: 'C54', attributesJson: '{"size":"S","color":"Red"}', priceMinor: null },
      { id: 'm', sku: 'C54-M', name: 'C54', attributesJson: '{"size":"M","color":"Blue"}', priceMinor: null },
      { id: 'l', sku: 'C54-L', name: 'C54', attributesJson: '{"size":"L","color":"Yellow"}', priceMinor: null },
      { id: 'duplicate', sku: 'C54-X', name: 'C54', attributesJson: '{"size":"S","color":"red"}', priceMinor: null },
    ])).toEqual([{ label: 'Size', values: ['S', 'M', 'L'] }, { label: 'Color', values: ['Red', 'Blue', 'Yellow'] }]);
  });
  it('renders actual product, safe contacts, variant price and image fallback', () => {
    const detail: ProductDetailPageData = { status: 'success', product, settings };
    const data = new BehaviorSubject({ productDetail: detail });
    TestBed.configureTestingModule({ imports: [ProductDetail], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { data, snapshot: { data: data.value } } }] });
    const fixture = TestBed.createComponent(ProductDetail);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Synthetic garment');
    expect(element.textContent).toContain('Synthetic category');
    expect(element.textContent).toContain('120.000');
    expect(element.querySelector('a[href="https://example.test/contact"]')).not.toBeNull();
    expect(element.textContent).not.toContain('Instagram');
    fixture.componentInstance.selectedVariant.set('v');
    fixture.detectChanges();
    expect(element.textContent).toContain('150.000');
    element.querySelector('.frame img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(element.textContent).toContain('Không có hình ảnh');
  });
  it('resets selections, failed images and copy status when the product changes', () => {
    const contacts = { ...settings, tiktokUrl: 'https://example.test/tiktok', otherContactUrl: 'https://example.test/other' };
    const data = new BehaviorSubject<{ productDetail: ProductDetailPageData }>({ productDetail: { status: 'success', product, settings: contacts } });
    TestBed.configureTestingModule({ imports: [ProductDetail], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { data, snapshot: { data: data.value } } }] });
    const fixture = TestBed.createComponent(ProductDetail);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.contacts().map(contact => contact.label)).toEqual(['Zalo', 'TikTok', 'Liên hệ']);
    component.selectedImage.set('i');
    component.selectedVariant.set('v');
    component.imageFailed('/media/example.jpg');
    component.copyStatus.set('Copied');
    data.next({ productDetail: { status: 'success', product: { ...product, id: 'other', slug: 'other' }, settings: contacts } });
    fixture.detectChanges();
    expect(component.selectedImage()).toBeNull();
    expect(component.selectedVariant()).toBeNull();
    expect(component.failedImages()).toEqual([]);
    expect(component.copyStatus()).toBe('');
    expect(component.image()?.url).toBe('/media/example.jpg');
  });
});
