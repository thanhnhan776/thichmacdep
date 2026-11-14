import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { XlsxRowValues } from './xlsx-parser';
import type { Category } from './catalog-api';

export interface AdminSession { user: { id: string; email: string }; csrfToken: string }
export interface AdminAuthConfig { googleClientId: string }
export interface ImportIssue { row: number | null; column: string; reason: string }
export interface ImportPreview {
  digest: string;
  catalogSnapshot: string;
  counts: { rows: number; goods: number; services: number; unknown: number; products: number; creates: number; updates: number; images: number };
  errors: ImportIssue[];
  skipped: ImportIssue[];
}
export interface ImportResult { created: number; updated: number }
export interface AdminProductInput {
  sku: string | null; slug: string; name: string; description: string | null; brandName: string | null;
  priceMinor: number | null; currency: string; isActive: boolean; isTrending: boolean; trendingSortOrder: number;
}
export type AdminProductUpdate = Omit<AdminProductInput, 'isTrending' | 'trendingSortOrder'> &
  Partial<Pick<AdminProductInput, 'isTrending' | 'trendingSortOrder'>>;
export interface AdminProduct extends Omit<AdminProductInput, 'isActive' | 'isTrending'> {
  id: string; isActive: boolean | number; isTrending: boolean | number; xlsxOwned: boolean | number;
  imageUrl?: string | null;
}
export interface AdminProductDetail extends AdminProduct { isHidden: boolean | number }
export interface AdminProductFilters { search?: string; status?: string; trending?: string; category?: string; sort?: string }
export interface AdminTrendingProduct { id: string; name: string; slug: string; trendingSortOrder: number; imageUrl?: string | null }
export interface AdminTrendingSnapshot { products: AdminTrendingProduct[]; version: string }
export interface AdminImage { id: string; url: string; position: number }
export interface AdminVariant { id: string; name: string; sku: string | null; description: string | null }

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly options = { withCredentials: true };

  config(): Promise<AdminAuthConfig> { return firstValueFrom(this.http.get<AdminAuthConfig>('/api/admin/auth/config', this.options)); }
  session(): Promise<AdminSession> { return firstValueFrom(this.http.get<AdminSession>('/api/admin/auth/session', this.options)); }
  challenge(): Promise<{ nonce: string }> { return firstValueFrom(this.http.post<{ nonce: string }>('/api/admin/auth/challenge', {}, this.options)); }
  login(idToken: string): Promise<{ ok: boolean }> { return firstValueFrom(this.http.post<{ ok: boolean }>('/api/admin/auth/login', { idToken }, this.options)); }
  logout(csrf: string): Promise<{ ok: boolean }> { return firstValueFrom(this.http.post<{ ok: boolean }>('/api/admin/auth/logout', {}, this.csrf(csrf))); }
  addAdmin(email: string, csrf: string): Promise<{ ok: boolean }> { return firstValueFrom(this.http.post<{ ok: boolean }>('/api/admin/users', { email }, this.csrf(csrf))); }
  preview(rows: XlsxRowValues[], csrf: string): Promise<ImportPreview> { return firstValueFrom(this.http.post<ImportPreview>('/api/admin/import/preview', { rows }, this.csrf(csrf))); }
  apply(rows: XlsxRowValues[], preview: ImportPreview, csrf: string): Promise<ImportResult> {
    return firstValueFrom(this.http.post<ImportResult>('/api/admin/import/apply', { rows, digest: preview.digest, catalogSnapshot: preview.catalogSnapshot }, this.csrf(csrf)));
  }
  products(limit = 50, offset = 0, filters: AdminProductFilters = {}): Promise<{ products: AdminProduct[]; total: number; limit: number; offset: number }> {
    const params: Record<string, string | number> = { limit, offset };
    for (const [key, value] of Object.entries(filters)) if (value) params[key] = value;
    return firstValueFrom(this.http.get<{ products: AdminProduct[]; total: number; limit: number; offset: number }>(
      '/api/admin/products', { ...this.options, params }));
  }
  categories(): Promise<Category[]> { return firstValueFrom(this.http.get<Category[]>('/api/categories')); }
  product(id: string): Promise<{ product: AdminProductDetail }> {
    return firstValueFrom(this.http.get<{ product: AdminProductDetail }>(`/api/admin/products/${encodeURIComponent(id)}`, this.options));
  }
  saveVisibility(id: string, isHidden: boolean, token: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.put<{ ok: boolean }>(`/api/admin/products/${encodeURIComponent(id)}/visibility`, { isHidden }, this.csrf(token)));
  }
  trendingProducts(): Promise<AdminTrendingSnapshot> {
    return firstValueFrom(this.http.get<AdminTrendingSnapshot>('/api/admin/products/trending', this.options));
  }
  orderTrending(productIds: string[], version: string, token: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.put<{ ok: boolean }>('/api/admin/products/trending', { productIds, version }, this.csrf(token)));
  }
  removeTrending(id: string, version: string, token: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.delete<{ ok: boolean }>(`/api/admin/products/trending/${encodeURIComponent(id)}`, { ...this.csrf(token), body: { version } }));
  }
  saveProduct(product: AdminProductUpdate, id: string | null, token: string): Promise<{ ok: boolean }> {
    const url = id ? `/api/admin/products/${encodeURIComponent(id)}` : '/api/admin/products';
    return firstValueFrom(id ? this.http.put<{ ok: boolean }>(url, product, this.csrf(token)) : this.http.post<{ ok: boolean }>(url, product, this.csrf(token)));
  }
  deleteProduct(id: string, token: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.delete<{ ok: boolean }>(`/api/admin/products/${encodeURIComponent(id)}`, this.csrf(token)));
  }
  variants(id: string): Promise<{ variants: AdminVariant[] }> {
    return firstValueFrom(this.http.get<{ variants: AdminVariant[] }>(`/api/admin/products/${encodeURIComponent(id)}/variants`, this.options));
  }
  saveVariantDescription(id: string, variantId: string, description: string | null, token: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.put<{ ok: boolean }>(`/api/admin/products/${encodeURIComponent(id)}/variants/${encodeURIComponent(variantId)}/description`, { description }, this.csrf(token)));
  }
  images(id: string, variantId?: string): Promise<{ images: AdminImage[]; version?: string }> {
    return firstValueFrom(this.http.get<{ images: AdminImage[]; version?: string }>(this.imagePath(id, variantId), this.options));
  }
  uploadImage(file: File, token: string): Promise<{ url: string }> {
    return firstValueFrom(this.http.post<{ url: string }>('/api/admin/images', file, {
      ...this.options, headers: new HttpHeaders({ 'X-CSRF-Token': token, 'Content-Type': file.type }),
    }));
  }
  attachImage(id: string, url: string, token: string): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(this.imagePath(id), { url }, this.csrf(token)));
  }
  attachVariantImage(id: string, variantId: string, imageId: string, token: string, version: string): Promise<{ ok: boolean; version: string }> {
    return firstValueFrom(this.http.post<{ ok: boolean; version: string }>(this.imagePath(id, variantId), { imageId, version }, this.csrf(token)));
  }
  orderImages(id: string, imageIds: string[], token: string, variantId?: string, version?: string): Promise<{ ok: boolean; version?: string }> {
    return firstValueFrom(this.http.put<{ ok: boolean; version?: string }>(this.imagePath(id, variantId), variantId ? { imageIds, version } : { imageIds }, this.csrf(token)));
  }
  deleteImage(id: string, imageId: string, token: string): Promise<{ ok: boolean }> {
    return firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.imagePath(id)}/${encodeURIComponent(imageId)}`, this.csrf(token)));
  }
  private imagePath(id: string, variantId?: string): string {
    return `/api/admin/products/${encodeURIComponent(id)}${variantId ? `/variants/${encodeURIComponent(variantId)}` : ''}/images`;
  }
  private csrf(token: string) { return { ...this.options, headers: new HttpHeaders({ 'X-CSRF-Token': token }) }; }
}
