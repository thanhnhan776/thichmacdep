import { RESPONSE_INIT, TransferState, makeStateKey } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { CatalogApi } from './catalog-api';
import { SeoTitleStrategy } from './seo';

describe('storefront routing', () => {
  const category = { id: 'c', slug: 'linen', name: 'Linen', parentId: null };
  let response: ResponseInit;
  let api: { categories: ReturnType<typeof vi.fn>; storeSettings: ReturnType<typeof vi.fn>; products: ReturnType<typeof vi.fn>; product: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    response = {};
    api = {
      categories: vi.fn().mockResolvedValue([category]),
      storeSettings: vi.fn().mockResolvedValue(null),
      products: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 }),
      product: vi.fn().mockResolvedValue(null),
    };
    TestBed.configureTestingModule({ providers: [provideRouter(routes, withComponentInputBinding()), { provide: CatalogApi, useValue: api }, { provide: RESPONSE_INIT, useValue: response }] });
  });

  it('renders home, listing and category in the resolved shell', async () => {
    const harness = await RouterTestingHarness.create();
    for (const path of ['/', '/products', '/categories/linen']) {
      await harness.navigateByUrl(path);
      expect(harness.routeNativeElement?.tagName.toLowerCase()).toBe('app-storefront-shell');
      expect(harness.routeNativeElement?.textContent).toContain('Linen');
    }
    expect(api.products).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'linen' }));
  });

  it('returns 404 for missing products and unknown routes without querying the shell for unknown routes', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/products/missing');
    expect(response.status).toBe(404);
    expect(api.product).toHaveBeenCalledWith('missing');
    api.categories.mockClear();
    response.status = 200;
    await harness.navigateByUrl('/unknown');
    expect(response.status).toBe(404);
    expect(harness.routeNativeElement?.textContent).toContain('Không tìm thấy trang');
    expect(api.categories).not.toHaveBeenCalled();
  });

  it('keeps the sample and admin routes independent of catalog data', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/_internal/sample');
    expect(harness.routeNativeElement?.textContent).toContain('Sample product');
    await harness.navigateByUrl('/admin/import');
    expect(harness.routeNativeElement?.querySelector('app-storefront-shell')).toBeFalsy();
    expect(api.categories).not.toHaveBeenCalled();
  });

  it('exposes shell API failures and retains a 500 status', async () => {
    api.storeSettings.mockRejectedValue(new Error('offline'));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/categories/missing');
    expect(response.status).toBe(500);
    expect(harness.routeNativeElement?.textContent).toContain('Thông tin cửa hàng hiện không khả dụng.');
  });

  it('retries a failed shell on later navigation', async () => {
    api.storeSettings.mockRejectedValueOnce(new Error('offline'));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/products');
    expect(harness.routeNativeElement?.textContent).toContain('Thông tin cửa hàng hiện không khả dụng.');
    await harness.navigateByUrl('/categories/linen');
    expect(harness.routeNativeElement?.textContent).not.toContain('Thông tin cửa hàng hiện không khả dụng.');
    expect(api.storeSettings).toHaveBeenCalledTimes(2);
  });

  it('routes proof and sample slugs to real product details', async () => {
    const harness = await RouterTestingHarness.create();
    for (const slug of ['proof', 'sample']) {
      await harness.navigateByUrl(`/products/${slug}`);
      expect(api.product).toHaveBeenLastCalledWith(slug);
    }
  });

  it('replaces metadata on navigation and removes canonical URLs for filters and errors', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: TitleStrategy, useClass: SeoTitleStrategy }] });
    TestBed.inject(TransferState).set(makeStateKey<string | null>('seo-site-origin'), 'https://shop.example');
    const document = TestBed.inject(DOCUMENT);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    expect(document.title).toBe('Thích Mặc Đẹp | Home');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Discover Thích Mặc Đẹp and explore our catalog.');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://shop.example/');
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://shop.example/');
    await harness.navigateByUrl('/?keyword=linen');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    await harness.navigateByUrl('/products');
    expect(document.title).toBe('Products | Thích Mặc Đẹp');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Explore products at Thích Mặc Đẹp.');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://shop.example/products');
    await harness.navigateByUrl('/categories/linen');
    expect(document.title).toContain('Linen');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://shop.example/categories/linen');
    await harness.navigateByUrl('/products?keyword=linen');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:url"]')).toBeNull();
    await harness.navigateByUrl('/products?utm_source=test');
    expect(harness.routeNativeElement?.textContent).not.toContain('Invalid');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
    await harness.navigateByUrl('/products/missing');
    expect(document.title).not.toContain('Linen');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
  });

  it('updates social preview images for products and falls back on navigation', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: TitleStrategy, useClass: SeoTitleStrategy }] });
    TestBed.inject(TransferState).set(makeStateKey<string | null>('seo-site-origin'), 'https://shop.example');
    api.product.mockResolvedValue({ id: 'p', sku: null, slug: 'item', name: 'Item', shortDescription: null, description: null, brandName: null, priceMinor: null, currency: 'VND', website: { seoTitle: null, seoDescription: null, marketingDescription: null, isFeatured: false, displayOrder: 0 }, images: [{ id: '2', url: 'https://cdn.example/later.png', altText: null, position: 2 }, { id: '1', url: '/images/item.png', altText: null, position: 1 }], variants: [], categories: [] });
    const document = TestBed.inject(DOCUMENT);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/products/item');
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://shop.example/images/item.png');
    expect(document.head.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe('https://shop.example/images/item.png');
    expect(document.head.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image');
    await harness.navigateByUrl('/');
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://shop.example/tmd-logo-cropped.png');
  });
});
