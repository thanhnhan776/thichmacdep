import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { XlsxRowValues } from './xlsx-parser';

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
  private csrf(token: string) { return { ...this.options, headers: new HttpHeaders({ 'X-CSRF-Token': token }) }; }
}
