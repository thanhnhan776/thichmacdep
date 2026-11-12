import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CatalogApi } from './catalog-api';

const row = { id: 'id', name: 'Synthetic', slug: 'synthetic', parentId: null, privateKey: 'must-not-transfer' };

describe('catalog API browser', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
  afterEach(() => TestBed.inject(HttpTestingController).verify());

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
