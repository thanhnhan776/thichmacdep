import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { vi } from 'vitest';
import * as XLSX from 'xlsx';
import { AdminApi, type ImportPreview } from './admin-api';
import { AdminImport } from './admin-import';
import type { XlsxRowValues } from './xlsx-parser';
import { routes } from './app.routes';

describe('admin import API', () => {
  let api: AdminApi;
  let http: HttpTestingController;
  const rows: XlsxRowValues[] = [{ 'Mã hàng': 'synthetic-sku' }, { 'Mã hàng': null }, { 'Mã hàng': 'another-sku' }];
  const preview: ImportPreview = {
    digest: 'a'.repeat(64), catalogSnapshot: 'b'.repeat(64),
    counts: { rows: 3, goods: 2, services: 0, unknown: 1, products: 1, creates: 1, updates: 0, images: 2 },
    errors: [], skipped: [],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(AdminApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('fetches public sign-in configuration from the same origin', async () => {
    const pending = api.config();
    const request = http.expectOne('/api/admin/auth/config');
    expect(request.request.method).toBe('GET');
    request.flush({ googleClientId: 'public-test-client' });
    expect(await pending).toEqual({ googleClientId: 'public-test-client' });
  });

  it('requests a challenge with a JSON POST', async () => {
    const pending = api.challenge();
    const request = http.expectOne('/api/admin/auth/challenge');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    expect(request.request.detectContentTypeHeader()).toBe('application/json');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ nonce: 'synthetic' });
    expect(await pending).toEqual({ nonce: 'synthetic' });
  });

  it('sends preview and explicitly applies the exact preview tokens with CSRF', async () => {
    const pendingPreview = api.preview(rows, 'csrf-synthetic');
    const request = http.expectOne('/api/admin/import/preview');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('csrf-synthetic');
    expect(request.request.body).toEqual({ rows });
    request.flush(preview);
    expect(await pendingPreview).toEqual(preview);
    const pendingApply = api.apply(rows, preview, 'csrf-synthetic');
    const apply = http.expectOne('/api/admin/import/apply');
    expect(apply.request.headers.get('X-CSRF-Token')).toBe('csrf-synthetic');
    expect(apply.request.body).toEqual({ rows, digest: preview.digest, catalogSnapshot: preview.catalogSnapshot });
    apply.flush({ created: 1, updated: 0 });
    expect(await pendingApply).toEqual({ created: 1, updated: 0 });
  });

  it('sends logout with credentials and CSRF', async () => {
    const pending = api.logout('csrf-synthetic');
    const request = http.expectOne('/api/admin/auth/logout');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('csrf-synthetic');
    request.flush({ ok: true });
    await pending;
  });

  it('adds an administrator with credentials and CSRF', async () => {
    const pending = api.addAdmin('new@gmail.com', 'csrf-synthetic');
    const request = http.expectOne('/api/admin/users');
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('csrf-synthetic');
    expect(request.request.body).toEqual({ email: 'new@gmail.com' });
    request.flush({ ok: true });
    await pending;
  });
});

describe('admin import screen', () => {
  it.each([
    ['admin', 'home'],
    ['admin/products', 'products'],
    ['admin/import', 'import'],
    ['admin/administrators', 'administrators'],
  ])('maps /%s to the %s area', (path, section) => {
    const route = routes.find(candidate => candidate.path === path);
    expect(route?.component).toBe(AdminImport);
    expect(route?.data?.['section']).toBe(section);
  });

  it('shows navigation and only the selected area for an authenticated administrator', async () => {
    const api = { session: vi.fn().mockResolvedValue({ user: { id: 'test', email: 'test@gmail.com' }, csrfToken: 'synthetic' }) };
    TestBed.configureTestingModule({ imports: [AdminImport], providers: [
      { provide: AdminApi, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { data: { section: 'administrators' } } } },
    ] });
    const fixture = TestBed.createComponent(AdminImport);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/admin/import"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[href="/admin/products"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[href="/admin/administrators"][aria-current="page"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#admin-email')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#workbook')).toBeNull();
  });

  it('shows sign-in instead of protected areas when the session is unauthorized', async () => {
    const api = { session: vi.fn().mockRejectedValue(new HttpErrorResponse({ status: 401 })) };
    TestBed.configureTestingModule({ imports: [AdminImport], providers: [
      { provide: AdminApi, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { data: { section: 'administrators' } } } },
    ] });
    const fixture = TestBed.createComponent(AdminImport);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Đăng nhập bằng Google');
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-email')).toBeNull();
  });

  it('shows the add-admin form only for a signed-in administrator and reports success', async () => {
    const api = { session: vi.fn().mockResolvedValue({ user: { id: 'test', email: 'test@gmail.com' }, csrfToken: 'synthetic' }), addAdmin: vi.fn().mockResolvedValue({ ok: true }) };
    TestBed.configureTestingModule({ imports: [AdminImport], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminImport);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.section.set('administrators');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#admin-email') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'new@gmail.com';
    await fixture.componentInstance.addAdmin(input.value, input);
    expect(api.addAdmin).toHaveBeenCalledWith('new@gmail.com', 'synthetic');
    expect(input.value).toBe('');
    expect(fixture.componentInstance.adminMessage()).toContain('Đã thêm quản trị viên');
    fixture.componentInstance.state.set('signed-out');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#admin-email')).toBeNull();
  });
  it('does not load Google or request a challenge when configuration is missing', async () => {
    const api = { config: vi.fn().mockResolvedValue({ googleClientId: '' }), challenge: vi.fn() };
    TestBed.configureTestingModule({ imports: [AdminImport], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminImport);
    await fixture.componentInstance.signIn();
    expect(fixture.componentInstance.message()).toBe('Chưa cấu hình đăng nhập Google.');
    expect(api.challenge).not.toHaveBeenCalled();
  });

  it('initializes Google with the public server configuration and challenge', async () => {
    const api = { config: vi.fn().mockResolvedValue({ googleClientId: 'public-test-client' }), challenge: vi.fn().mockResolvedValue({ nonce: 'test-nonce' }) };
    const initialize = vi.fn(), renderButton = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton } } };
    const container = document.createElement('div');
    container.id = 'google-signin';
    document.body.appendChild(container);
    try {
      TestBed.configureTestingModule({ imports: [AdminImport], providers: [{ provide: AdminApi, useValue: api }] });
      const fixture = TestBed.createComponent(AdminImport);
      await fixture.componentInstance.signIn();
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'public-test-client', nonce: 'test-nonce' }));
      expect(renderButton).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ locale: 'vi' }));
    } finally { container.remove(); delete window.google; }
  });
  it('shows validation errors and prevents applying an invalid preview', async () => {
    const api = { session: vi.fn().mockResolvedValue({ user: { id: 'test', email: 'test@example.com' }, csrfToken: 'synthetic' }), apply: vi.fn() };
    TestBed.configureTestingModule({ imports: [AdminImport], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminImport);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.state.set('ready');
    fixture.componentInstance.preview.set({
      digest: 'a'.repeat(64), catalogSnapshot: 'b'.repeat(64),
      counts: { rows: 1, goods: 1, services: 0, unknown: 0, products: 1, creates: 1, updates: 0, images: 1 },
      errors: [{ row: 2, column: 'Mã hàng', reason: 'Invalid value' }], skipped: [],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Giá trị không hợp lệ');
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(element => element.textContent?.includes('Áp dụng nhập dữ liệu'));
    expect(button?.disabled).toBe(true);
    await fixture.componentInstance.apply();
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('sends parsed flat rows including blanks to both operations and resets the file input', async () => {
    const preview: ImportPreview = { digest: 'a'.repeat(64), catalogSnapshot: 'b'.repeat(64),
      counts: { rows: 3, goods: 2, services: 0, unknown: 1, products: 2, creates: 2, updates: 0, images: 2 }, errors: [], skipped: [] };
    const api = { session: vi.fn().mockResolvedValue({ user: { id: 'test', email: 'test@example.com' }, csrfToken: 'synthetic' }),
      preview: vi.fn().mockResolvedValue(preview), apply: vi.fn().mockResolvedValue({ created: 2, updated: 0 }) };
    TestBed.configureTestingModule({ imports: [AdminImport], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminImport);
    fixture.detectChanges();
    await fixture.whenStable();
    const headers = ['Loại hàng', 'Mã hàng', 'Tên hàng', 'Nhóm hàng(3 Cấp)', 'Giá bán', 'Đang kinh doanh', 'Được bán trực tiếp', 'Hình ảnh (url1,url2...)', 'Thuộc tính'];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ['Hàng hóa', 'one'], [], ['Hàng hóa', 'two']]), 'Products');
    const file = new Blob([XLSX.write(book, { bookType: 'xlsx', type: 'array' })]);
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    input.value = 'synthetic';
    await fixture.componentInstance.selectFile({ target: input } as unknown as Event);
    expect(input.value).toBe('');
    const rows = api.preview.mock.calls[0][0] as XlsxRowValues[];
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row['Mã hàng'])).toEqual(['one', null, 'two']);
    expect(rows[1]).toEqual(Object.fromEntries(headers.map(header => [header, null])));
    await fixture.componentInstance.apply();
    expect(api.apply).toHaveBeenCalledWith(rows, preview, 'synthetic');
  });

  it.each([
    ['rows', 401, 'dòng (401/400)'],
    ['products', 101, 'nhóm sản phẩm (101/100)'],
    ['images', 1001, 'ảnh (1001/1.000)'],
  ] as const)('blocks an import exceeding the %s limit', async (field, value, message) => {
    const api = { session: vi.fn().mockResolvedValue({ user: { id: 'test', email: 'test@example.com' }, csrfToken: 'synthetic' }), apply: vi.fn() };
    TestBed.configureTestingModule({ imports: [AdminImport], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminImport);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.state.set('ready');
    fixture.componentInstance.preview.set({ digest: 'a'.repeat(64), catalogSnapshot: 'b'.repeat(64),
      counts: { rows: 400, goods: 1, services: 0, unknown: 0, products: 100, creates: 1, updates: 0, images: 1000, [field]: value }, errors: [], skipped: [] });
    (fixture.componentInstance as unknown as { rows: XlsxRowValues[] }).rows = [{}];
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(message);
    expect(fixture.nativeElement.textContent).toContain('chia nhỏ hoặc giảm dữ liệu');
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(element => element.textContent?.includes('Áp dụng nhập dữ liệu'));
    expect(button?.disabled).toBe(true);
    await fixture.componentInstance.apply();
    expect(api.apply).not.toHaveBeenCalled();
  });
});
