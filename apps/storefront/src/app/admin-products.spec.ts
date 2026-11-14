import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AdminApi, type AdminProduct } from './admin-api';
import { AdminProducts } from './admin-products';
import { routes } from './app.routes';

describe('admin products API', () => {
  it('updates website visibility with encoded id, credentials and CSRF', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(AdminApi), http = TestBed.inject(HttpTestingController);
    const result = api.saveVisibility('p /', true, 'csrf');
    const request = http.expectOne('/api/admin/products/p%20%2F/visibility');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ isHidden: true });
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('csrf');
    request.flush({ ok: true }); await result;
    http.verify();
  });
  it('appends a product image to a variant with credentials and CSRF', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(AdminApi), http = TestBed.inject(HttpTestingController);
    const result = api.attachVariantImage('p /', 'v /', 'image', 'csrf', 'version');
    const request = http.expectOne('/api/admin/products/p%20%2F/variants/v%20%2F/images');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ imageId: 'image', version: 'version' });
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('csrf');
    request.flush({ ok: true }); await result;
    http.verify();
  });
  it('saves a nullable variant description with credentials and CSRF', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(AdminApi), http = TestBed.inject(HttpTestingController);
    const result = api.saveVariantDescription('p /', 'v /', null, 'csrf');
    const request = http.expectOne('/api/admin/products/p%20%2F/variants/v%20%2F/description');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ description: null });
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('csrf');
    request.flush({ ok: true }); await result;
    http.verify();
  });
  it('loads available categories from the public catalog endpoint', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(AdminApi), http = TestBed.inject(HttpTestingController);
    const result = api.categories();
    http.expectOne('/api/categories').flush([{ id: 'c', name: 'Áo', slug: 'ao', parentId: null }]);
    expect((await result)[0].slug).toBe('ao');
    http.verify();
  });
  it('uses credentials and CSRF for complete trending ordering', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(AdminApi), http = TestBed.inject(HttpTestingController);
    const load = api.trendingProducts();
    const get = http.expectOne('/api/admin/products/trending');
    expect(get.request.withCredentials).toBe(true);
    get.flush({ products: [], version: 'v' }); await load;
    const save = api.orderTrending(['b', 'a'], 'v', 'csrf');
    const put = http.expectOne('/api/admin/products/trending');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ productIds: ['b', 'a'], version: 'v' });
    expect(put.request.headers.get('X-CSRF-Token')).toBe('csrf');
    expect(put.request.withCredentials).toBe(true);
    put.flush({ ok: true }); await save;
    http.verify();
  });
  it('removes a trending product with encoded id, version, credentials and CSRF', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(AdminApi), http = TestBed.inject(HttpTestingController);
    const result = api.removeTrending('p /', 'v1', 'csrf');
    const request = http.expectOne('/api/admin/products/trending/p%20%2F');
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toEqual({ version: 'v1' });
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('csrf');
    request.flush({ ok: true }); await result;
    http.verify();
  });
  it('fetches an encoded product id with credentials', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(AdminApi), http = TestBed.inject(HttpTestingController);
    const result = api.product('id with space');
    const request = http.expectOne('/api/admin/products/id%20with%20space');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ product: { id: 'id with space' } });
    await result;
    http.verify();
  });
  it('sends nonempty filters with pagination and credentials', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(AdminApi), http = TestBed.inject(HttpTestingController);
    const result = api.products(50, 100, { search: 'shirt & coat', status: 'active', trending: 'false', category: 'tops', sort: 'trending-asc' });
    const request = http.expectOne(req => req.url === '/api/admin/products');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.params.get('search')).toBe('shirt & coat');
    expect(request.request.params.get('status')).toBe('active');
    expect(request.request.params.get('trending')).toBe('false');
    expect(request.request.params.get('category')).toBe('tops');
    expect(request.request.params.get('sort')).toBe('trending-asc');
    expect(request.request.params.get('offset')).toBe('100');
    request.flush({ products: [], total: 0, limit: 50, offset: 100 }); await result;
    http.verify();
  });
  it('sends product, upload and image ordering writes with credentials and CSRF', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(AdminApi), http = TestBed.inject(HttpTestingController);
    const product = { sku: null, slug: 'test', name: 'Test', description: null, brandName: null, priceMinor: 100,
      currency: 'VND', isActive: true, isTrending: false, trendingSortOrder: 0 };
    const save = api.saveProduct(product, 'id', 'csrf');
    const request = http.expectOne('/api/admin/products/id');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual(product);
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('csrf');
    request.flush({ ok: true }); await save;
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const upload = api.uploadImage(file, 'csrf');
    const uploadRequest = http.expectOne('/api/admin/images');
    expect(uploadRequest.request.body).toBe(file);
    expect(uploadRequest.request.headers.get('Content-Type')).toBe('image/png');
    expect(uploadRequest.request.headers.get('X-CSRF-Token')).toBe('csrf');
    uploadRequest.flush({ url: 'https://cdn.example/image.png' }); await upload;
    const order = api.orderImages('id', ['b', 'a'], 'csrf', 'variant', 'version');
    const orderRequest = http.expectOne('/api/admin/products/id/variants/variant/images');
    expect(orderRequest.request.body).toEqual({ imageIds: ['b', 'a'], version: 'version' });
    expect(orderRequest.request.headers.get('X-CSRF-Token')).toBe('csrf');
    orderRequest.flush({ ok: true }); await order;
    http.verify();
  });
});

describe('website visibility editor', () => {
  const product = { id: 'p', sku: 'SKU', slug: 'test', name: 'Test', description: null,
    brandName: null, priceMinor: 100, currency: 'VND', isActive: 0, isTrending: 0,
    trendingSortOrder: 0, xlsxOwned: 1, isHidden: 1 };

  it('loads imported inactive visibility independently and saves only explicit changes', async () => {
    const api = { product: vi.fn().mockResolvedValue({ product }), images: vi.fn().mockResolvedValue({ images: [] }),
      variants: vi.fn().mockResolvedValue({ variants: [] }), saveProduct: vi.fn().mockResolvedValue({ ok: true }),
      saveVisibility: vi.fn().mockResolvedValue({ ok: true }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    const component = fixture.componentInstance;
    component.mode = 'editor'; component.productId = 'p'; component.csrfToken = 'csrf';
    fixture.detectChanges(); await vi.waitFor(() => expect(component.editorLoaded()).toBe(true));
    fixture.changeDetectorRef.markForCheck(); fixture.detectChanges();
    const hidden = fixture.nativeElement.querySelector('input[name="hidden"]') as HTMLInputElement;
    expect(hidden.checked).toBe(true);
    expect(fixture.nativeElement.querySelector('input[name="active"]').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('#visibility-hint').textContent).toContain('Đang bán');
    await component.save();
    expect(api.saveVisibility).not.toHaveBeenCalled();
    expect(api.saveProduct.mock.calls[0][0]).not.toHaveProperty('isHidden');
    hidden.click(); fixture.detectChanges();
    await component.saveVisibility();
    expect(api.saveVisibility).toHaveBeenCalledWith('p', false, 'csrf');
    expect(component.draft.isActive).toBe(false);
    await component.saveVisibility();
    expect(api.saveVisibility).toHaveBeenCalledTimes(1);
  });

  it('retains an unsaved choice on failure and reports session expiry', async () => {
    const api = { product: vi.fn().mockResolvedValue({ product }), images: vi.fn().mockResolvedValue({ images: [] }),
      variants: vi.fn().mockResolvedValue({ variants: [] }), saveVisibility: vi.fn()
        .mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }))
        .mockRejectedValueOnce(new HttpErrorResponse({ status: 403 })) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const component = TestBed.createComponent(AdminProducts).componentInstance;
    component.mode = 'editor'; component.productId = 'p';
    await component.loadEditor();
    component.isHidden = false;
    await component.saveVisibility();
    expect(component.error()).toContain('xung đột');
    expect(component.isHidden).toBe(false);
    const expired = vi.spyOn(component.sessionExpired, 'emit');
    await component.saveVisibility();
    expect(expired).toHaveBeenCalled();
    expect(api.saveVisibility).toHaveBeenCalledTimes(2);
  });

  it('explains the default for new products without offering an unsaved visibility control', async () => {
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: {} }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor';
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('input[name="hidden"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Sản phẩm mới mặc định không bị ẩn');
  });
});

describe('product editor price', () => {
  it('never sends the order from stale edits, while saving intentional trending changes', async () => {
    const api = { images: vi.fn().mockResolvedValue({ images: [] }), variants: vi.fn().mockResolvedValue({ variants: [] }),
      saveProduct: vi.fn().mockResolvedValue({ ok: true }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const component = TestBed.createComponent(AdminProducts).componentInstance;
    const product: AdminProduct = { id: 'p', sku: null, slug: 'test', name: 'Test', description: null,
      brandName: null, priceMinor: 100, currency: 'VND', isActive: true, isTrending: true, trendingSortOrder: 5, xlsxOwned: false };
    await component.edit(product);
    component.draft.description = 'Edited after reorder';
    await component.save();
    expect(api.saveProduct.mock.calls[0][0]).not.toHaveProperty('trendingSortOrder');
    expect(api.saveProduct.mock.calls[0][0]).not.toHaveProperty('isTrending');
    component.draft.isTrending = false;
    component.draft.trendingSortOrder = 99;
    await component.save();
    expect(api.saveProduct.mock.calls[1][0].isTrending).toBe(false);
    expect(api.saveProduct.mock.calls[1][0]).not.toHaveProperty('trendingSortOrder');
  });
  it('shows the trending checkbox and sales label without a manual order field', async () => {
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: {} }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor';
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('input[name="trending"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#product-order')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="active"]').parentElement.textContent).toContain('Đang bán');
  });
  it('formats minor units without changing zero, null or large valid integers', () => {
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: {} }] });
    const component = TestBed.createComponent(AdminProducts).componentInstance;
    const input = document.createElement('input');
    for (const [value, formatted, expected] of [
      ['', '', null], ['0', '0', 0], ['1234567', '1.234.567', 1234567], ['9007199254740991', '9.007.199.254.740.991', Number.MAX_SAFE_INTEGER],
    ] as const) {
      input.value = value; component.updatePrice(input);
      expect(input.value).toBe(formatted);
      expect(component.draft.priceMinor).toBe(expected);
      expect(component.priceInvalid).toBe(false);
    }
    input.value = '9007199254740992'; component.updatePrice(input);
    expect(component.priceInvalid).toBe(true);
    expect(component.draft.priceMinor).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('trending product ordering', () => {
  const items = [
    { id: 'a', name: 'Áo', slug: 'ao', trendingSortOrder: 2 },
    { id: 'b', name: 'Váy', slug: 'vay', trendingSortOrder: 5 },
  ];
  it('renders thumbnails, keyboard links and icon controls without row navigation on controls', async () => {
    const api = { products: vi.fn().mockResolvedValue({ products: [], total: 0 }),
      categories: vi.fn().mockResolvedValue([]),
      trendingProducts: vi.fn().mockResolvedValue({ products: [{ ...items[0], imageUrl: '/image.png' }, items[1]], version: 'v1' }),
      orderTrending: vi.fn().mockResolvedValue({ ok: true }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.showTrending(); fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('.trending-row');
    expect(row.querySelector('img').getAttribute('src')).toBe('/image.png');
    expect(row.querySelector('a').getAttribute('href')).toBe('/admin/products/a/edit');
    expect(row.querySelector('[aria-label="Đưa Áo lên đầu"]').disabled).toBe(true);
    expect(row.querySelector('[aria-label="Đưa Áo xuống cuối"]').disabled).toBe(false);
    const encode = vi.spyOn(fixture.componentInstance, 'encodeId');
    const toggles: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.sort-actions-toggle');
    toggles[0].click(); fixture.detectChanges();
    expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
    expect(toggles[1].getAttribute('aria-expanded')).toBe('false');
    toggles[1].click(); fixture.detectChanges();
    expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
    const focus = vi.spyOn(toggles[0], 'focus');
    row.querySelector('[aria-label="Đưa Áo xuống"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
    expect(toggles[1].getAttribute('aria-expanded')).toBe('true');
    expect(focus).toHaveBeenCalled();
    toggles[0].click(); fixture.detectChanges();
    encode.mockClear();
    row.querySelector('[aria-label="Đưa Áo xuống"]')!.click();
    expect(encode).not.toHaveBeenCalled();
    await fixture.whenStable();
    expect(api.orderTrending).toHaveBeenCalledWith(['b', 'a'], 'v1', '');
    vi.restoreAllMocks();
  });
  it('blocks duplicate removal while busy and reloads the updated snapshot', async () => {
    let finish!: (value: { ok: boolean }) => void;
    const api = { trendingProducts: vi.fn().mockResolvedValueOnce({ products: items, version: 'v1' })
      .mockResolvedValueOnce({ products: [items[1]], version: 'v2' }),
      removeTrending: vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; })) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const component = TestBed.createComponent(AdminProducts).componentInstance;
    component.csrfToken = 'csrf';
    await component.showTrending();
    const pending = component.removeTrending(items[0]);
    await component.removeTrending(items[1]);
    expect(component.trendingBusy()).toBe(true);
    expect(api.removeTrending).toHaveBeenCalledOnce();
    expect(api.removeTrending).toHaveBeenCalledWith('a', 'v1', 'csrf');
    finish({ ok: true }); await pending;
    expect(component.trendingBusy()).toBe(false);
    expect(component.trendingVersion()).toBe('v2');
    expect(component.trendingProducts()).toEqual([items[1]]);
  });
  it('requires a refresh after a removal conflict or a failed post-write reload', async () => {
    const api = { trendingProducts: vi.fn().mockResolvedValue({ products: items, version: 'v1' }),
      removeTrending: vi.fn().mockRejectedValueOnce(new HttpErrorResponse({ status: 409 })).mockResolvedValue({ ok: true }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const component = TestBed.createComponent(AdminProducts).componentInstance;
    await component.showTrending();
    await component.removeTrending(items[0]);
    expect(component.trendingError()).toContain('tải lại');
    expect(component.trendingBusy()).toBe(false);
    await component.removeTrending(items[0]);
    expect(api.removeTrending).toHaveBeenCalledOnce();
    await component.refreshTrending();
    api.trendingProducts.mockRejectedValueOnce(new Error('offline'));
    await component.removeTrending(items[0]);
    expect(component.trendingVersion()).toBe('');
    expect(component.trendingBusy()).toBe(false);
    expect(component.trendingError()).toContain('tải lại');
    await component.refreshTrending();
    expect(component.trendingVersion()).toBe('v1');
  });
  it('saves the full ordering and reloads the version for subsequent moves', async () => {
    const api = { products: vi.fn().mockResolvedValue({ products: [], total: 0 }),
      trendingProducts: vi.fn().mockResolvedValueOnce({ products: items, version: 'v1' })
        .mockResolvedValueOnce({ products: [items[1], items[0]], version: 'v2' }),
      orderTrending: vi.fn().mockResolvedValue({ ok: true }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable();
    fixture.componentInstance.csrfToken = 'csrf';
    await fixture.componentInstance.showTrending();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Đưa Áo lên"]').disabled).toBe(true);
    await fixture.componentInstance.reorderTrending(0, 1);
    expect(api.orderTrending).toHaveBeenCalledWith(['b', 'a'], 'v1', 'csrf');
    expect(fixture.componentInstance.trendingVersion()).toBe('v2');
    expect(fixture.componentInstance.trendingProducts().map(p => p.id)).toEqual(['b', 'a']);
  });
  it('blocks stale reordering until the user refreshes after conflict', async () => {
    const api = { products: vi.fn().mockResolvedValue({ products: [], total: 0 }),
      trendingProducts: vi.fn().mockResolvedValue({ products: items, version: 'v1' }),
      orderTrending: vi.fn().mockRejectedValue(new HttpErrorResponse({ status: 409 })) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.showTrending();
    await fixture.componentInstance.reorderTrending(0, 1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('tải lại');
    await fixture.componentInstance.reorderTrending(0, 1);
    expect(api.orderTrending).toHaveBeenCalledTimes(1);
    await fixture.componentInstance.refreshTrending();
    expect(fixture.componentInstance.trendingVersion()).toBe('v1');
  });
  it('reorders by drag and drop', async () => {
    const api = { products: vi.fn().mockResolvedValue({ products: [], total: 0 }),
      trendingProducts: vi.fn().mockResolvedValue({ products: items, version: 'v1' }),
      orderTrending: vi.fn().mockResolvedValue({ ok: true }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.showTrending();
    fixture.componentInstance.startTrendingDrag(0, { dataTransfer: null } as DragEvent);
    await fixture.componentInstance.dropTrending(1, { preventDefault: () => {} } as DragEvent);
    expect(api.orderTrending).toHaveBeenCalledWith(['b', 'a'], 'v1', '');
  });
});

describe('admin product editor', () => {
  const product: AdminProduct = { id: 'p', sku: null, slug: 'test', name: 'Test', description: null, brandName: null,
    priceMinor: null, currency: 'VND', isActive: 1, isTrending: 0, trendingSortOrder: 0, xlsxOwned: 0 };
  it('moves product and variant images to either edge and disables boundary and busy controls', async () => {
    const images = ['a', 'b', 'c'].map((id, position) => ({ id, url: `/${id}.png`, position }));
    const api = { images: vi.fn().mockResolvedValue({ images, version: 'v1' }), variants: vi.fn().mockResolvedValue({ variants: [] }),
      orderImages: vi.fn().mockResolvedValue({ ok: true, version: 'v1' }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts), component = fixture.componentInstance;
    component.mode = 'editor'; component.csrfToken = 'csrf';
    fixture.detectChanges(); await fixture.whenStable();
    await component.edit(product);
    await component.selectVariant('v');
    component.selectedImages.set(['a', 'b', 'c']); fixture.detectChanges();
    const button = (label: string): HTMLButtonElement => fixture.nativeElement.querySelector(`[aria-label="${label}"]`);
    button('Thao tác cho ảnh 3').click();
    button('Thao tác cho ảnh đã chọn 3').click(); fixture.detectChanges();
    expect(button('Thao tác cho ảnh 3').getAttribute('aria-expanded')).toBe('true');
    expect(button('Thao tác cho ảnh 2').getAttribute('aria-expanded')).toBe('false');
    expect(button('Thao tác cho ảnh đã chọn 3').getAttribute('aria-expanded')).toBe('true');
    expect(button('Đưa ảnh 1 lên đầu').disabled).toBe(true);
    expect(button('Đưa ảnh 3 xuống cuối').disabled).toBe(true);
    expect(button('Đưa ảnh đã chọn 1 lên đầu').disabled).toBe(true);
    expect(button('Đưa ảnh đã chọn 3 xuống cuối').disabled).toBe(true);
    button('Đưa ảnh 3 lên đầu').click(); await fixture.whenStable();
    expect(api.orderImages).toHaveBeenLastCalledWith('p', ['c', 'a', 'b'], 'csrf', undefined, undefined);
    fixture.detectChanges();
    button('Đưa ảnh 1 xuống cuối').click(); await fixture.whenStable();
    expect(api.orderImages).toHaveBeenLastCalledWith('p', ['b', 'c', 'a'], 'csrf', undefined, undefined);
    fixture.detectChanges();
    button('Đưa ảnh đã chọn 3 lên đầu').click(); await fixture.whenStable();
    expect(api.orderImages).toHaveBeenLastCalledWith('p', ['c', 'a', 'b'], 'csrf', 'v', 'v1');
    fixture.detectChanges();
    button('Đưa ảnh đã chọn 1 xuống cuối').click(); await fixture.whenStable();
    expect(api.orderImages).toHaveBeenLastCalledWith('p', ['a', 'b', 'c'], 'csrf', 'v', 'v1');
    component.busy.set(true); fixture.detectChanges();
    expect(button('Đưa ảnh 2 lên đầu').disabled).toBe(true);
    expect(button('Đưa ảnh đã chọn 2 xuống cuối').disabled).toBe(true);
  });

  it('keeps image removal confirmation when clicking the trash control', async () => {
    const image = { id: 'a', url: '/a.png', position: 0 };
    const api = { images: vi.fn().mockResolvedValue({ images: [image] }), variants: vi.fn().mockResolvedValue({ variants: [] }),
      deleteImage: vi.fn().mockResolvedValue({ ok: true }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor'; fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.edit(product); fixture.detectChanges();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const remove: HTMLButtonElement = fixture.nativeElement.querySelector('[aria-label="Xóa ảnh 1"]');
    expect(remove.querySelector('svg')).toBeTruthy();
    remove.click(); await fixture.whenStable();
    expect(confirm).toHaveBeenCalledWith('Xóa ảnh khỏi sản phẩm và các biến thể?');
    expect(api.deleteImage).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    remove.click(); await fixture.whenStable();
    expect(api.deleteImage).toHaveBeenCalledWith('p', 'a', '');
    vi.restoreAllMocks();
  });
  it('disables draft controls until the save completes', async () => {
    let finish!: () => void;
    const api = { saveProduct: vi.fn().mockReturnValue(new Promise<void>(resolve => { finish = resolve; })) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor';
    fixture.componentInstance.editingId.set('p');
    fixture.detectChanges(); await fixture.whenStable();
    const save = fixture.componentInstance.save();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#product-description').matches(':disabled')).toBe(true);
    expect(fixture.nativeElement.querySelector('#product-name').matches(':disabled')).toBe(true);
    finish(); await save; fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#product-description').matches(':disabled')).toBe(false);
  });

  it('restores a variant checkbox when saving its selection fails', async () => {
    const api = {
      images: vi.fn().mockImplementation((_id: string, variant?: string) => Promise.resolve({ images: variant ? [] : [
        { id: 'a', url: 'https://example.com/a', position: 0 },
      ], version: 'v1' })),
      variants: vi.fn().mockResolvedValue({ variants: [{ id: 'v', name: 'Blue', sku: null }] }),
      orderImages: vi.fn().mockRejectedValue(new Error('Unavailable')),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor';
    fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.edit(product);
    await fixture.componentInstance.selectVariant('v');
    fixture.detectChanges();
    const checkbox: HTMLInputElement = fixture.nativeElement.querySelector('#variant-images-title ~ label.check input');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await fixture.whenStable(); fixture.detectChanges();
    expect(api.orderImages).toHaveBeenCalledWith('p', ['a'], '', 'v', 'v1');
    expect(checkbox.checked).toBe(false);
    expect(fixture.componentInstance.selectedImages()).toEqual([]);
    expect(fixture.componentInstance.error()).toContain('Không thể hoàn tất');
  });

  it('loads categories, applies the selection and clears filters and sorting', async () => {
    const api = { products: vi.fn().mockResolvedValue({ products: [], total: 0 }),
      categories: vi.fn().mockResolvedValue([{ id: 'c', name: 'Áo', slug: 'ao', parentId: null }]) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
    fixture.detectChanges();
    const input: HTMLSelectElement = fixture.nativeElement.querySelector('#product-category');
    expect(input.textContent).toContain('Áo');
    input.value = 'ao'; input.dispatchEvent(new Event('change'));
    fixture.componentInstance.filters.sort = 'trending-asc';
    await fixture.componentInstance.applyFilters();
    expect(api.products).toHaveBeenLastCalledWith(50, 0, { category: 'ao', sort: 'trending-asc' });
    await fixture.componentInstance.clearFilters();
    expect(api.products).toHaveBeenLastCalledWith(50, 0);
    expect(fixture.componentInstance.filters.category).toBe('');
  });
  it('renders product data and applies filters from the first page', async () => {
    const item = { ...product, sku: 'SKU-1', imageUrl: 'https://example.com/a.png', priceMinor: 120000, isTrending: 1 };
    const api = { products: vi.fn().mockResolvedValue({ products: [item], total: 51 }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.changePage(50);
    fixture.componentInstance.filters = { search: ' Test ', status: 'active', trending: 'true', category: 'tops' };
    await fixture.componentInstance.applyFilters();
    expect(api.products).toHaveBeenLastCalledWith(50, 0, { search: 'Test', status: 'active', trending: 'true', category: 'tops' });
    expect(fixture.componentInstance.offset()).toBe(0);
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('table');
    expect(table.textContent).toContain('SKU-1');
    expect(table.textContent).toContain('Nổi bật');
    expect(table.textContent).toContain('Đang bán');
    const status: HTMLSelectElement = fixture.nativeElement.querySelector('#product-status');
    expect(status.querySelector('option[value="active"]')?.textContent).toBe('Đang bán');
    expect(status.querySelector('option[value="inactive"]')?.textContent).toBe('Ngừng bán');
    expect(table.querySelector('img').getAttribute('src')).toBe(item.imageUrl);
    expect(table.querySelector('[aria-label="Sửa Test"]')).toBeTruthy();
    expect(table.querySelector('[aria-label="Sửa Test"]').getAttribute('href')).toBe('/admin/products/p/edit');
    expect(fixture.nativeElement.querySelector('#editor-title')).toBeNull();
  });

  it('labels inactive products as no longer for sale', async () => {
    const api = { products: vi.fn().mockResolvedValue({ products: [{ ...product, isActive: 0 }], total: 1 }),
      categories: vi.fn().mockResolvedValue([]) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await vi.waitFor(() => expect(fixture.componentInstance.listLoaded()).toBe(true));
    fixture.changeDetectorRef.markForCheck(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('table').textContent).toContain('Ngừng bán');
  });

  it('keeps row navigation away from interactive controls and exposes a keyboard link', async () => {
    const api = { products: vi.fn().mockResolvedValue({ products: [product], total: 1 }),
      categories: vi.fn().mockResolvedValue([]), deleteProduct: vi.fn() };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
    fixture.detectChanges();
    const encode = vi.spyOn(fixture.componentInstance, 'encodeId');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fixture.nativeElement.querySelector('[aria-label="Xóa Test"] svg').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(confirm).toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[aria-label="Sửa Test"]').tagName).toBe('A');
    vi.restoreAllMocks();
  });

  it('offers retry when categories fail to load', async () => {
    const api = { products: vi.fn().mockResolvedValue({ products: [], total: 0 }),
      categories: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Không thể tải danh mục');
    await fixture.componentInstance.loadCategories();
    expect(fixture.componentInstance.categoriesError()).toBe(false);
  });

  it('shows a retryable error instead of an empty result on load failure', async () => {
    const api = { products: vi.fn().mockRejectedValue(new Error('Unavailable')) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Không thể tải sản phẩm');
    expect(fixture.nativeElement.textContent).not.toContain('Không tìm thấy sản phẩm');
  });
  it('indicates and disables XLSX-owned fields while leaving editorial fields editable', async () => {
    const imported = { ...product, xlsxOwned: 1 };
    const api = { products: vi.fn().mockResolvedValue({ products: [imported], total: 1 }),
      images: vi.fn().mockResolvedValue({ images: [] }), variants: vi.fn().mockResolvedValue({ variants: [] }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor';
    fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.edit(imported);
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('quản lý bằng XLSX');
    expect(fixture.nativeElement.textContent).toContain('giá, tiền tệ và trạng thái');
    expect(fixture.nativeElement.querySelector('#product-name').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('#product-currency').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('#product-description').disabled).toBe(false);
    fixture.componentInstance.create(); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#product-name').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('#product-currency').disabled).toBe(false);
  });
  it('blocks assignment after load failure until retry succeeds', async () => {
    const api = {
      products: vi.fn().mockResolvedValue({ products: [product], total: 1 }),
      images: vi.fn().mockImplementation((_id: string, variant?: string) => variant
        ? Promise.reject(new Error('Unavailable'))
        : Promise.resolve({ images: [{ id: 'a', url: 'https://example.com/a', position: 0 }, { id: 'b', url: 'https://example.com/b', position: 1 }] })),
      variants: vi.fn().mockResolvedValue({ variants: [{ id: 'v', name: 'Blue', sku: null }] }),
      orderImages: vi.fn().mockResolvedValue({ ok: true, version: 'v2' }),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor'; fixture.componentInstance.csrfToken = 'csrf';
    fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.edit(product);
    await fixture.componentInstance.selectVariant('v');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Không thể tải ảnh biến thể');
    await fixture.componentInstance.toggleVariantImage('b', true);
    await fixture.componentInstance.moveImage(0, 1, true);
    expect(api.orderImages).not.toHaveBeenCalled();
    api.images.mockResolvedValue({ images: [{ id: 'a', url: 'https://example.com/a', position: 0 }], version: 'v1' });
    const retry = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'Thử lại');
    expect(retry).toBeTruthy();
    retry!.click(); await fixture.whenStable();
    expect(fixture.componentInstance.selectedImages()).toEqual(['a']);
    await fixture.componentInstance.toggleVariantImage('b', true);
    expect(api.orderImages).toHaveBeenCalledWith('p', ['a', 'b'], 'csrf', 'v', 'v1');
  });

  it('ignores a stale variant image response', async () => {
    let resolveFirst!: (value: { images: Array<{ id: string }> }) => void;
    const api = {
      products: vi.fn().mockResolvedValue({ products: [product], total: 1 }),
      images: vi.fn().mockImplementation((_id: string, variant?: string) => variant === 'first'
        ? new Promise(resolve => { resolveFirst = resolve; })
        : Promise.resolve({ images: variant ? [{ id: 'b' }] : [], version: 'v1' })),
      variants: vi.fn().mockResolvedValue({ variants: [] }),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor'; fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.edit(product);
    const first = fixture.componentInstance.selectVariant('first');
    await fixture.componentInstance.selectVariant('second');
    resolveFirst({ images: [{ id: 'a' }] }); await first;
    expect(fixture.componentInstance.selectedImages()).toEqual(['b']);
    expect(fixture.componentInstance.variantImagesState()).toBe('ready');
  });

  it('loads images and variants and persists selection and order', async () => {
    const api = {
      products: vi.fn().mockResolvedValue({ products: [product], total: 1 }),
      images: vi.fn().mockImplementation((_id: string, variant?: string) => Promise.resolve({ images: variant ? [] : [
        { id: 'a', url: 'https://example.com/a', position: 0 }, { id: 'b', url: 'https://example.com/b', position: 1 },
      ], version: 'v1' })),
      variants: vi.fn().mockResolvedValue({ variants: [{ id: 'v', name: 'Blue', sku: null }] }),
      orderImages: vi.fn().mockResolvedValue({ ok: true, version: 'v2' }),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor';
    fixture.componentInstance.csrfToken = 'csrf';
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
    await fixture.componentInstance.edit(product);
    await fixture.componentInstance.selectVariant('v');
    await fixture.componentInstance.toggleVariantImage('a', true);
    await fixture.componentInstance.toggleVariantImage('b', true);
    await fixture.componentInstance.moveImage(1, -1, true);
    expect(api.orderImages).toHaveBeenLastCalledWith('p', ['b', 'a'], 'csrf', 'v', 'v2');
    expect(fixture.componentInstance.selectedImages()).toEqual(['b', 'a']);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Blue');
  });

  it.each(['toggle', 'reorder'] as const)('reloads another admin’s selection after a stale %s', async operation => {
    const image = (id: string, position: number) => ({ id, url: `/${id}`, position });
    let serverImages = [image('a', 0), image('b', 1)];
    let serverVersion = 'admin-a';
    const api = {
      images: vi.fn().mockImplementation(async () => ({ images: [...serverImages], version: serverVersion })),
      orderImages: vi.fn().mockImplementation(async (_product: string, _ids: string[], _token: string, _variant: string, version: string) => {
        if (version !== serverVersion) throw new HttpErrorResponse({ status: 409 });
        return { ok: true, version: serverVersion };
      }),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const component = TestBed.createComponent(AdminProducts).componentInstance;
    component.editingId.set('p');
    await component.selectVariant('v');
    serverImages = [image('b', 0), image('a', 1), image('c', 2)];
    serverVersion = 'admin-b';
    if (operation === 'toggle') await component.toggleVariantImage('a', false);
    else await component.reorderImages(0, 1, true);
    expect(api.orderImages).toHaveBeenCalledWith('p', operation === 'toggle' ? ['b'] : ['b', 'a'], '', 'v', 'admin-a');
    expect(component.selectedImages()).toEqual(['b', 'a', 'c']);
    expect(component.variantImagesState()).toBe('ready');
    expect(component.error()).toContain('đã thay đổi');
    expect(component.message()).toBe('');
    await component.toggleVariantImage('c', false);
    expect(api.orderImages).toHaveBeenLastCalledWith('p', ['b', 'a'], '', 'v', 'admin-b');
  });

  it('reloads after a stale upload assignment and preserves the uploaded product image', async () => {
    let serverVersion = 'admin-a';
    let selected = ['a'];
    const api = {
      uploadImage: vi.fn().mockResolvedValue({ url: 'url' }),
      attachImage: vi.fn().mockImplementation(async () => {
        serverVersion = 'admin-b'; selected = ['a', 'other-admin'];
        return { id: 'new' };
      }),
      attachVariantImage: vi.fn().mockRejectedValue(new HttpErrorResponse({ status: 409 })),
      images: vi.fn().mockImplementation(async (_product: string, variant?: string) => ({
        images: (variant ? selected : ['a', 'other-admin', 'new']).map((id, position) => ({ id, url: id, position })),
        version: serverVersion,
      })),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const component = TestBed.createComponent(AdminProducts).componentInstance;
    component.editingId.set('p'); await component.selectVariant('v');
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png', { type: 'image/png' })] });
    await component.uploadVariant({ target: input } as unknown as Event);
    expect(api.attachVariantImage).toHaveBeenCalledWith('p', 'v', 'new', '', 'admin-a');
    expect(component.images().map(image => image.id)).toEqual(['a', 'other-admin', 'new']);
    expect(component.selectedImages()).toEqual(['a', 'other-admin']);
    expect(component.variantImagesState()).toBe('ready');
    expect(component.error()).toContain('chưa thể gắn vào biến thể');
    expect(component.message()).toBe('');
  });

  it('loads an editor deep link independently of the list', async () => {
    const imported = { ...product, xlsxOwned: 1 };
    const api = { product: vi.fn().mockResolvedValue({ product: imported }),
      images: vi.fn().mockResolvedValue({ images: [] }), variants: vi.fn().mockResolvedValue({ variants: [] }) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor'; fixture.componentInstance.productId = 'p';
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(); await fixture.whenStable();
    expect(api.product).toHaveBeenCalledWith('p');
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.querySelector('#product-name').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('/admin/products');
  });

  it('shows a retryable load error without an editable form', async () => {
    const api = { product: vi.fn().mockRejectedValue(new Error('Unavailable')) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.componentInstance.mode = 'editor'; fixture.componentInstance.productId = 'missing';
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Không thể hoàn tất');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Thử lại');
  });

  it('registers separate editor routes and preserves import', () => {
    expect(routes.find(route => route.path === 'admin/products/new')?.data?.['section']).toBe('product-editor');
    expect(routes.find(route => route.path === 'admin/products/:id/edit')?.data?.['section']).toBe('product-editor');
    expect(routes.find(route => route.path === 'admin/import')?.data?.['section']).toBe('import');
  });

  it('reports a failed image attachment without claiming success', async () => {
    const api = {
      products: vi.fn().mockResolvedValue({ products: [], total: 0 }),
      uploadImage: vi.fn().mockResolvedValue({ url: 'https://example.com/image' }),
      attachImage: vi.fn().mockRejectedValue(new Error('failed')),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
    fixture.componentInstance.editingId.set('p');
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png', { type: 'image/png' })] });
    await fixture.componentInstance.upload({ target: input } as unknown as Event);
    expect(api.attachImage).toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('không thể gắn vào sản phẩm');
    expect(fixture.componentInstance.message()).toBe('');
  });

  it('uploads to the product library and appends to the selected variant', async () => {
    const api = {
      uploadImage: vi.fn().mockResolvedValue({ url: 'url' }),
      attachImage: vi.fn().mockResolvedValue({ id: 'new' }),
      attachVariantImage: vi.fn().mockResolvedValue({ ok: true, version: 'v2' }),
      images: vi.fn().mockImplementation((_id: string, variant?: string) => Promise.resolve({
        images: (variant ? ['old', 'new'] : ['product-old', 'new']).map((id, position) => ({ id, url: id, position })), version: 'v1',
      })),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts), component = fixture.componentInstance;
    component.mode = 'editor'; component.csrfToken = 'csrf'; component.editingId.set('p');
    await component.selectVariant('v');
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png', { type: 'image/png' })] });
    await component.uploadVariant({ target: input } as unknown as Event);
    expect(api.attachImage).toHaveBeenCalledWith('p', 'url', 'csrf');
    expect(api.attachVariantImage).toHaveBeenCalledWith('p', 'v', 'new', 'csrf', 'v1');
    expect(component.images().map(image => image.id)).toEqual(['product-old', 'new']);
    expect(component.selectedImages()).toEqual(['old', 'new']);
    expect(component.message()).toContain('gắn cho biến thể');
  });

  it.each([
    ['uploadImage', 'Không thể tải ảnh lên'],
    ['attachImage', 'chưa thể thêm vào sản phẩm'],
    ['attachVariantImage', 'chưa thể gắn vào biến thể'],
  ])('reports the partial result when %s fails', async (failed, message) => {
    const api = {
      uploadImage: vi.fn().mockResolvedValue({ url: 'url' }),
      attachImage: vi.fn().mockResolvedValue({ id: 'new' }),
      attachVariantImage: vi.fn().mockResolvedValue({ ok: true }),
      images: vi.fn().mockResolvedValue({ images: [], version: 'v1' }),
    };
    api[failed as 'uploadImage' | 'attachImage' | 'attachVariantImage'].mockRejectedValue(new Error('failed'));
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const component = TestBed.createComponent(AdminProducts).componentInstance;
    component.editingId.set('p'); await component.selectVariant('v');
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png', { type: 'image/png' })] });
    await component.uploadVariant({ target: input } as unknown as Event);
    expect(component.error()).toContain(message);
    expect(component.message()).toBe('');
  });

  it('keeps the original target when selection changes during upload', async () => {
    let resolveUpload!: (value: { url: string }) => void;
    const api = {
      uploadImage: vi.fn().mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; })),
      attachImage: vi.fn().mockResolvedValue({ id: 'new' }),
      attachVariantImage: vi.fn().mockResolvedValue({ ok: true }),
      images: vi.fn().mockImplementation((_id: string, variant?: string) => Promise.resolve({ images: variant === 'other' ? [{ id: 'other-image' }] : [], version: 'v1' })),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const component = TestBed.createComponent(AdminProducts).componentInstance;
    component.editingId.set('p'); await component.selectVariant('v');
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png', { type: 'image/png' })] });
    const pending = component.uploadVariant({ target: input } as unknown as Event);
    await component.selectVariant('other');
    resolveUpload({ url: 'url' }); await pending;
    expect(api.attachVariantImage).toHaveBeenCalledWith('p', 'v', 'new', '', 'v1');
    expect(component.selectedImages()).toEqual(['other-image']);
  });

  it('disables variant upload until the variant images have loaded', async () => {
    const api = { images: vi.fn().mockImplementation(() => new Promise(() => {})) };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts), component = fixture.componentInstance;
    component.mode = 'editor'; component.editorLoaded.set(true); component.editingId.set('p');
    void component.selectVariant('v');
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('#variant-image') as HTMLInputElement).disabled).toBe(true);
  });

  it('navigates pages and returns to the last page after deletion', async () => {
    const api = {
      products: vi.fn().mockImplementation((_limit: number, offset: number) =>
        Promise.resolve({ products: offset ? [product] : [], total: 51 })),
      deleteProduct: vi.fn().mockResolvedValue({ ok: true }),
    };
    TestBed.configureTestingModule({ imports: [AdminProducts], providers: [{ provide: AdminApi, useValue: api }] });
    const fixture = TestBed.createComponent(AdminProducts);
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
    await fixture.componentInstance.changePage(50);
    expect(api.products).toHaveBeenLastCalledWith(50, 50);
    expect(fixture.componentInstance.offset()).toBe(50);
    api.products.mockResolvedValue({ products: [], total: 50 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await fixture.componentInstance.removeProduct(product);
    expect(api.products).toHaveBeenLastCalledWith(50, 0);
    expect(fixture.componentInstance.offset()).toBe(0);
    vi.restoreAllMocks();
  });
});
