import { isPlatformServer } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, TransferState } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface WebsiteProductSettings { seoTitle: string | null; seoDescription: string | null; marketingDescription: string | null; isFeatured: boolean; displayOrder: number }
export interface Product { id: string; sku: string | null; slug: string; name: string; shortDescription: string | null; description: string | null; brandName: string | null; priceMinor: number | null; currency: string; website: WebsiteProductSettings }
export interface Category { id: string; name: string; slug: string; parentId: string | null }
export interface ProductListItem extends Product { primaryImage: { url: string; altText: string | null } | null; sizes: string[] }
export interface ProductDetail extends Product { images: { id: string; url: string; altText: string | null; position: number }[]; variants: { id: string; sku: string | null; name: string; attributesJson: string | null; priceMinor: number | null }[]; categories: Category[] }
export interface ProductPage { items: ProductListItem[]; total: number; page: number; pageSize: number }
export interface StoreSettings { storeName: string; defaultCurrency: string; tiktokUrl: string | null; instagramUrl: string | null; zaloUrl: string | null; messengerUrl: string | null; otherContactUrl: string | null; logoUrl: string | null }
export type ProductSort = 'newest' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc';
export interface ProductQuery { page?: number; pageSize?: number; keyword?: string; category?: string; sort?: ProductSort }

const MAX_BYTES = 256 * 1024;
type Parser<T> = (value: unknown) => T;
const invalid = (): never => { throw new Error('Invalid catalog response'); };
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const str = (v: unknown): string => typeof v === 'string' && v.length <= MAX_BYTES ? v : invalid();
const nullable = <T>(parse: Parser<T>): Parser<T | null> => v => v === null ? null : parse(v);
const integer = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) ? v : invalid();
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const array = <T>(parse: Parser<T>): Parser<T[]> => v => Array.isArray(v) && v.length <= 10000 ? v.map(parse) : invalid();
const ns = nullable(str), ni = nullable(integer);
const category: Parser<Category> = v => { const x = obj(v); return { id: str(x['id']), name: str(x['name']), slug: str(x['slug']), parentId: ns(x['parentId']) }; };
const product: Parser<Product> = v => { const x = obj(v), w = obj(x['website']); return {
  id: str(x['id']), sku: ns(x['sku']), slug: str(x['slug']), name: str(x['name']), shortDescription: ns(x['shortDescription']), description: ns(x['description']), brandName: ns(x['brandName']), priceMinor: ni(x['priceMinor']), currency: str(x['currency']),
  website: { seoTitle: ns(w['seoTitle']), seoDescription: ns(w['seoDescription']), marketingDescription: ns(w['marketingDescription']), isFeatured: bool(w['isFeatured']), displayOrder: integer(w['displayOrder']) },
}; };
const image = (v: unknown) => { const x = obj(v); return { url: str(x['url']), altText: ns(x['altText']) }; };
const listItem: Parser<ProductListItem> = v => { const x = obj(v); return { ...product(v), primaryImage: nullable(image)(x['primaryImage']), sizes: array(str)(x['sizes']) }; };
const detail: Parser<ProductDetail> = v => { const x = obj(v); return { ...product(v), images: array(v => { const x = obj(v); return { id: str(x['id']), ...image(v), position: integer(x['position']) }; })(x['images']), variants: array(v => { const x = obj(v); return { id: str(x['id']), sku: ns(x['sku']), name: str(x['name']), attributesJson: ns(x['attributesJson']), priceMinor: ni(x['priceMinor']) }; })(x['variants']), categories: array(category)(x['categories']) }; };
const page: Parser<ProductPage> = v => { const x = obj(v); const result = { items: array(listItem)(x['items']), total: integer(x['total']), page: integer(x['page']), pageSize: integer(x['pageSize']) }; if (result.total < 0 || result.page < 1 || result.pageSize < 1 || result.pageSize > 100 || result.items.length > result.pageSize) invalid(); return result; };
const settings: Parser<StoreSettings> = v => { const x = obj(v); return { storeName: str(x['storeName']), defaultCurrency: str(x['defaultCurrency']), tiktokUrl: ns(x['tiktokUrl']), instagramUrl: ns(x['instagramUrl']), zaloUrl: ns(x['zaloUrl']), messengerUrl: ns(x['messengerUrl']), otherContactUrl: ns(x['otherContactUrl']), logoUrl: ns(x['logoUrl']) }; };

// Accept decoded slugs only. Encoded input is decoded once and then encoded as one segment.
export function slugSegment(input: string): string {
  let slug: string;
  try { slug = decodeURIComponent(input); } catch { throw new Error('Invalid slug'); }
  if (!slug.trim() || slug.length > 200 || /[/\\%?#\u0000-\u001f\u007f]/.test(slug) || slug === '.' || slug === '..') throw new Error('Invalid slug');
  return encodeURIComponent(slug);
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status !== 200 || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new Error('Catalog unavailable');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error('Catalog response too large'); chunks.push(value); } } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly http = inject(HttpClient);
  private readonly state = inject(TransferState);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  private readonly context = inject(REQUEST_CONTEXT) as { catalogFetch?: (request: Request) => Promise<Response> } | null;

  products(query: ProductQuery = {}): Promise<ProductPage> {
    const { page: p = 1, pageSize = 20, keyword, category: filter, sort = 'newest' } = query;
    if (!Number.isSafeInteger(p) || p < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger((p - 1) * pageSize)) throw new Error('Invalid pagination');
    const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
    if (!['newest', 'price-asc', 'price-desc', 'name-asc', 'name-desc'].includes(sort)) throw new Error('Invalid sort');
    params.set('sort', sort);
    for (const [key, value] of [['keyword', keyword], ['category', filter]] as const) if (value !== undefined) { if (!value.trim() || value.length > 200) throw new Error('Invalid query'); params.set(key, value); }
    return this.get(`/api/products?${params}`, page, false) as Promise<ProductPage>;
  }
  product(slug: string): Promise<ProductDetail | null> { return this.get(`/api/products/${slugSegment(slug)}`, detail, true); }
  categories(): Promise<Category[]> { return this.get('/api/categories', array(category), false) as Promise<Category[]>; }
  category(slug: string): Promise<Category | null> { return this.get(`/api/categories/${slugSegment(slug)}`, category, true); }
  storeSettings(): Promise<StoreSettings | null> { return this.get('/api/store-settings', settings, true); }

  private async get<T>(path: string, parse: Parser<T>, allow404: boolean): Promise<T | null> {
    const key = makeStateKey<unknown>(`catalog-v1:${path}`);
    if (!this.server && this.state.hasKey(key)) {
      const value = this.state.get(key, null); this.state.remove(key);
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BYTES) throw new Error('Catalog response too large');
      return parse(value);
    }
    let value: unknown;
    if (this.server) {
      if (typeof this.context?.catalogFetch !== 'function') throw new Error('Catalog binding unavailable');
      const response = await this.context.catalogFetch(new Request(`https://catalog.internal${path}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000) }));
      if (response.status === 404 && !response.redirected && allow404) return null;
      value = await readResponse(response);
    } else {
      try {
        const response = await firstValueFrom(this.http.get<unknown>(path, { observe: 'response', transferCache: false, redirect: 'error' }));
        if (response.status !== 200 || response.redirected) throw new Error('Catalog unavailable');
        value = response.body;
      } catch (error) { if (allow404 && error instanceof HttpErrorResponse && error.status === 404 && !error.redirected) return null; throw error; }
    }
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BYTES) throw new Error('Catalog response too large');
    const normalized = parse(value);
    if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_BYTES) throw new Error('Catalog response too large');
    if (this.server) this.state.set(key, normalized);
    return normalized;
  }
}
