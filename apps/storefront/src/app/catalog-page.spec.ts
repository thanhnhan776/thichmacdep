import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ActivatedRouteSnapshot, convertToParamMap, provideRouter, RouterStateSnapshot } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { CatalogApi, ProductListItem } from './catalog-api';
import { CatalogPage, CatalogPageData, resolveCatalogPage } from './catalog-page';

const category = { id: 'c', name: 'Synthetic category', slug: 'synthetic', parentId: null };
const product: ProductListItem = { id: 'p', sku: null, slug: 'item', name: 'Synthetic item', shortDescription: null, description: null, brandName: null, priceMinor: null, currency: 'VND', website: { seoTitle: null, seoDescription: null, marketingDescription: null, isFeatured: false, displayOrder: 0 }, primaryImage: null, sizes: [] };

describe('catalog page resolver', () => {
  let response: ResponseInit;
  let api: { categories: ReturnType<typeof vi.fn>; products: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    response = {};
    api = { categories: vi.fn().mockResolvedValue([category]), products: vi.fn().mockResolvedValue({ items: [product], total: 13, page: 1, pageSize: 12 }) };
    TestBed.configureTestingModule({ providers: [{ provide: CatalogApi, useValue: api }, { provide: RESPONSE_INIT, useValue: response }] });
  });
  function resolve(query: Record<string, string | string[]> = {}, params: Record<string, string> = {}) {
    const route = { queryParamMap: convertToParamMap(query), paramMap: convertToParamMap(params) } as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() => resolveCatalogPage(route, {} as RouterStateSnapshot)) as Promise<CatalogPageData>;
  }
  it('awaits catalog data and passes supported filters to the API', async () => {
    const result = await resolve({ keyword: 'dress', category: 'synthetic', page: '2' });
    expect(result.status).toBe('success');
    expect(api.products).toHaveBeenCalledWith({ keyword: 'dress', category: 'synthetic', page: 2, pageSize: 12, sort: 'trending' });
  });
  it('orders category filters while preserving the order of unlisted categories', async () => {
    const names = ['Extra B', 'Khác', 'Áo dài', 'Sơ mi', 'Chân váy', 'Áo kiểu', 'Quần dài', 'Extra A', 'Áo khoác'];
    const categories = names.map((name, index) => ({ id: String(index), name, slug: String(index), parentId: null }));
    api.categories.mockResolvedValueOnce(categories);
    const result = await resolve();
    expect(result.status === 'success' && result.categories.map(item => item.name)).toEqual(['Áo khoác', 'Quần dài', 'Áo kiểu', 'Sơ mi', 'Áo dài', 'Chân váy', 'Khác', 'Extra B', 'Extra A']);
    expect(categories.map(item => item.name)).toEqual(names);
  });
  it('rejects invalid and repeated parameters with 400', async () => {
    expect((await resolve({ page: ['1', '2'] })).status).toBe('invalid');
    expect(response.status).toBe(400);
    expect(api.categories).not.toHaveBeenCalled();
    expect((await resolve({ page: '0' })).status).toBe('invalid');
    expect((await resolve({ keyword: ['a', 'b'], utm_source: 'test' })).status).toBe('invalid');
    expect((await resolve({ unknown: 'test' })).status).toBe('invalid');
  });
  it('ignores tracking parameters without forwarding them to the API', async () => {
    expect((await resolve({ utm_source: ['one', 'two'], utm_campaign: 'launch' })).status).toBe('success');
    expect(api.products).toHaveBeenCalledWith({ page: 1, pageSize: 12, keyword: undefined, category: undefined, sort: 'trending' });
    expect(response.status).toBeUndefined();
  });
  it('accepts every explicit sorting option', async () => {
    for (const sort of ['trending', 'newest', 'price-asc', 'price-desc', 'name-asc', 'name-desc']) {
      expect((await resolve({ sort })).status).toBe('success');
      expect(api.products).toHaveBeenLastCalledWith(expect.objectContaining({ sort }));
    }
  });
  it('returns 404 for an unknown category and 500 for an API failure', async () => {
    expect((await resolve({ category: 'missing' })).status).toBe('not-found');
    expect(response.status).toBe(404);
    expect(api.products).not.toHaveBeenCalled();
    api.categories.mockRejectedValueOnce(new Error('offline'));
    expect((await resolve()).status).toBe('error');
    expect(response.status).toBe(500);
  });
});

describe('catalog page', () => {
  it('translates name sorting options when the language changes', () => {
    const catalog: CatalogPageData = { status: 'success', categories: [], category: null, query: { page: 1, pageSize: 12 }, products: { items: [], page: 1, pageSize: 12, total: 0 } };
    const data = new BehaviorSubject({ catalog });
    TestBed.configureTestingModule({ imports: [CatalogPage], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { data, snapshot: { data: data.value } } }] });
    const fixture = TestBed.createComponent(CatalogPage);
    fixture.componentInstance.language.current.set('vi');
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('select option[value="trending"]') as HTMLOptionElement).selected).toBe(true);
    const labels = () => Array.from(fixture.nativeElement.querySelectorAll('option[value^="name-"]') as NodeListOf<HTMLOptionElement>).map(option => option.textContent?.trim());
    expect(labels()).toEqual(['Tên A–Z', 'Tên Z–A']);
    fixture.componentInstance.language.current.set('en');
    fixture.detectChanges();
    expect(labels()).toEqual(['Name A–Z', 'Name Z–A']);
  });
  it('renders products, category links, accurate counts and URL-backed pagination', () => {
    const catalog: CatalogPageData = { status: 'success', categories: [category], category, query: { page: 1, pageSize: 12, category: category.slug }, products: { items: [product], page: 1, pageSize: 12, total: 13 } };
    const data = new BehaviorSubject({ catalog });
    TestBed.configureTestingModule({ imports: [CatalogPage], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { data, snapshot: { data: data.value } } }] });
    const fixture = TestBed.createComponent(CatalogPage);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Synthetic item');
    expect(element.textContent).toContain('Đang hiển thị 1–1 trong tổng số 13 kết quả');
    expect(element.querySelector('[aria-label="Trang tiếp theo"]')?.getAttribute('href')).toContain('page=2');
    expect(element.querySelector('label[for="catalog-search"]')).not.toBeNull();
  });
  it('preserves page size, sorting and filters in both pagination links', () => {
    const catalog: CatalogPageData = { status: 'success', categories: [category], category, query: { page: 2, pageSize: 24, sort: 'price-asc', keyword: 'linen', category: category.slug }, products: { items: [product], page: 2, pageSize: 24, total: 60 } };
    const data = new BehaviorSubject({ catalog });
    TestBed.configureTestingModule({ imports: [CatalogPage], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { data, snapshot: { data: data.value } } }] });
    const fixture = TestBed.createComponent(CatalogPage);
    fixture.detectChanges();
    const links = fixture.nativeElement.querySelectorAll('.pagination a') as NodeListOf<HTMLAnchorElement>;
    expect(links.length).toBe(2);
    for (const [index, link] of Array.from(links).entries()) {
      const params = new URL(link.href, 'http://localhost').searchParams;
      expect(params.get('page')).toBe(index === 0 ? '1' : '3');
      expect(params.get('pageSize')).toBe('24');
      expect(params.get('sort')).toBe('price-asc');
      expect(params.get('keyword')).toBe('linen');
      expect(params.get('category')).toBe(category.slug);
    }
  });
});
