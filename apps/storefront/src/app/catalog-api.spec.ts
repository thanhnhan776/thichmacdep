import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CatalogApi } from './catalog-api';

const row = { id: 'id', name: 'Synthetic', slug: 'synthetic', parentId: null, privateKey: 'must-not-transfer' };

describe('catalog API browser', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('defaults to trending and forwards explicit sorts and filters', async () => {
    const api = TestBed.inject(CatalogApi), http = TestBed.inject(HttpTestingController);
    for (const sort of [undefined, 'trending', 'newest', 'price-asc', 'price-desc', 'name-asc', 'name-desc'] as const) {
      const pending = api.products({ sort, keyword: 'linen', category: 'tops', page: 2, pageSize: 12 });
      const request = http.expectOne(req => new URL(req.url, 'http://localhost').pathname === '/api/products');
      const params = new URL(request.request.url, 'http://localhost').searchParams;
      expect(params.get('sort')).toBe(sort ?? 'trending');
      expect(params.get('keyword')).toBe('linen');
      expect(params.get('category')).toBe('tops');
      expect(params.get('page')).toBe('2');
      request.flush({ items: [], total: 0, page: 2, pageSize: 12 });
      await pending;
    }
  });

  it('uses same-origin GET, normalizes public fields and distinguishes 404', async () => {
    const api = TestBed.inject(CatalogApi), http = TestBed.inject(HttpTestingController);
    const pending = api.category('áo%20đẹp');
    const request = http.expectOne('/api/categories/%C3%A1o%20%C4%91%E1%BA%B9p');
    expect(request.request.method).toBe('GET');
    expect(request.request.transferCache).toBe(false);
    request.flush(row);
    expect(await pending).toEqual({ id: 'id', name: 'Synthetic', slug: 'synthetic', parentId: null });
    const missing = api.storeSettings();
    http.expectOne('/api/store-settings').flush({}, { status: 404, statusText: 'Not Found' });
    expect(await missing).toBeNull();
    expect(() => api.product('%2f%2fevil.example')).toThrow();
    expect(() => api.product('%252f')).toThrow();
  });

  it('rejects malformed responses and server errors', async () => {
    const api = TestBed.inject(CatalogApi), http = TestBed.inject(HttpTestingController);
    const malformed = api.categories(); http.expectOne('/api/categories').flush([{}]);
    await expect(malformed).rejects.toThrow();
    const failed = api.categories(); http.expectOne('/api/categories').flush({}, { status: 500, statusText: 'Error' });
    await expect(failed).rejects.toThrow();
  });
  it('parses variant images in order and accepts legacy variants', async () => {
    const api = TestBed.inject(CatalogApi), http = TestBed.inject(HttpTestingController);
    const image = { id: 'i', url: '/i.jpg', altText: null, position: 2, privateKey: 'secret' };
    const variant = { id: 'v', sku: null, name: 'Variant', attributesJson: null, priceMinor: null };
    const body = { id: 'p', sku: null, slug: 'p', name: 'Product', shortDescription: null, description: null, brandName: null, priceMinor: null, currency: 'VND', website: { seoTitle: null, seoDescription: null, marketingDescription: null, isFeatured: false, displayOrder: 0 }, images: [image], variants: [{ ...variant, description: 'Variant description', images: [image] }, { ...variant, id: 'old' }], categories: [] };
    const pending = api.product('p'); http.expectOne('/api/products/p').flush(body);
    const result = await pending;
    expect(result?.variants[0].images).toEqual([{ id: 'i', url: '/i.jpg', altText: null, position: 2 }]);
    expect(result?.variants[1].images).toBeUndefined();
    expect(result?.variants.map(item => item.description)).toEqual(['Variant description', null]);
    const invalidDescription = api.product('p'); http.expectOne('/api/products/p').flush({ ...body, variants: [{ ...variant, description: 42 }] });
    await expect(invalidDescription).rejects.toThrow();
    const bad = api.product('p'); http.expectOne('/api/products/p').flush({ ...body, variants: [{ ...variant, images: [null] }] });
    await expect(bad).rejects.toThrow();
  });
});

describe('catalog API SSR', () => {
  it('uses only the request binding and transfers normalized public data once', async () => {
    const calls: Request[] = [];
    TestBed.configureTestingModule({ providers: [provideHttpClient(), { provide: PLATFORM_ID, useValue: 'server' }, { provide: REQUEST_CONTEXT, useValue: { catalogFetch: async (request: Request) => { calls.push(request); return Response.json([row]); } } }] });
    const api = TestBed.inject(CatalogApi), state = TestBed.inject(TransferState);
    expect(await api.categories()).toEqual([{ id: 'id', name: 'Synthetic', slug: 'synthetic', parentId: null }]);
    expect(calls[0].url).toBe('https://catalog.internal/api/categories');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].redirect).toBe('manual');
    expect(state.toJson()).not.toContain('must-not-transfer');
    const json = state.toJson();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const browserState = TestBed.inject(TransferState);
    // Hydration normally populates TransferState from the serialized script.
    for (const [key, value] of Object.entries(JSON.parse(json))) browserState.set(key as never, value);
    const browser = TestBed.inject(CatalogApi), http = TestBed.inject(HttpTestingController);
    expect(await browser.categories()).toEqual([{ id: 'id', name: 'Synthetic', slug: 'synthetic', parentId: null }]);
    http.expectNone('/api/categories');
    const second = browser.categories(); http.expectOne('/api/categories').flush([]); expect(await second).toEqual([]);
    http.verify();
  });

  it('rejects redirects and does not transfer failures', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), { provide: PLATFORM_ID, useValue: 'server' }, { provide: REQUEST_CONTEXT, useValue: { catalogFetch: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }) } }] });
    await expect(TestBed.inject(CatalogApi).categories()).rejects.toThrow();
    expect(TestBed.inject(TransferState).toJson()).toBe('{}');
  });
});
