import { ChangeDetectionStrategy, Component, computed, inject, RESPONSE_INIT } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ResolveFn, Router, RouterLink } from '@angular/router';
import { CatalogApi, Category, ProductPage, ProductQuery } from './catalog-api';
import { ProductCard } from './product-card';
import { LanguageService } from './language';

export type CatalogPageData =
  | { status: 'success'; categories: Category[]; category: Category | null; query: ProductQuery; products: ProductPage }
  | { status: 'invalid' | 'not-found' | 'error' };

const CATEGORY_ORDER = ['Áo khoác', 'Quần dài', 'Áo kiểu', 'Sơ mi', 'Áo dài', 'Chân váy', 'Khác'];

function sortCategories(categories: Category[]): Category[] {
  const rank = (category: Category) => {
    const index = CATEGORY_ORDER.indexOf(category.name);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return [...categories].sort((a, b) => rank(a) - rank(b));
}

// Wire as resolve: { catalog: resolveCatalogPage }, with
// runGuardsAndResolvers: 'paramsOrQueryParamsChange'. Optional category routes
// may use :categorySlug; the query-string form is shared with the shell.
export const resolveCatalogPage: ResolveFn<CatalogPageData> = async route => {
  const api = inject(CatalogApi);
  const response = inject(RESPONSE_INIT, { optional: true });
  const fail = (status: 'invalid' | 'not-found' | 'error', code: number): CatalogPageData => {
    if (response && (response.status !== 500 || code === 500)) response.status = code;
    return { status };
  };
  const params = route.queryParamMap;
  if (params.keys.some(key => ['keyword', 'category', 'page', 'pageSize', 'sort'].includes(key) ? params.getAll(key).length !== 1 : !/^utm_[a-z0-9_]+$/i.test(key))) return fail('invalid', 400);
  const keyword = params.get('keyword') ?? undefined;
  const queryCategory = params.get('category') ?? undefined;
  const pathCategory = route.paramMap.get('categorySlug') ?? undefined;
  const category = pathCategory ?? queryCategory;
  const pageText = params.get('page');
  const sizeText = params.get('pageSize');
  const pageSize = sizeText === null ? 12 : Number(sizeText);
  const sort = params.get('sort') ?? 'newest';
  if ((pathCategory && queryCategory && pathCategory !== queryCategory)
      || [keyword, category].some(value => value !== undefined && (!value.trim() || value.length > 200))
      || (pageText !== null && !/^[1-9]\d*$/.test(pageText))
      || (sizeText !== null && !['12', '24', '48'].includes(sizeText))
      || !['newest', 'price-asc', 'price-desc', 'name-asc', 'name-desc'].includes(sort)) return fail('invalid', 400);
  const page = pageText === null ? 1 : Number(pageText);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * pageSize)) return fail('invalid', 400);
  const query: ProductQuery = { page, pageSize, keyword, category, sort: sort as ProductQuery['sort'] };
  try {
    const categories = await api.categories();
    const selected = category === undefined ? null : categories.find(item => item.slug === category);
    if (selected === undefined) return fail('not-found', 404);
    const products = await api.products(query);
    return { status: 'success', categories: sortCategories(categories), category: selected, query, products };
  } catch {
    return fail('error', 500);
  }
};

@Component({
  selector: 'app-catalog-page',
  imports: [RouterLink, ProductCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.css',
})
export class CatalogPage {
  readonly language = inject(LanguageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly routeData = toSignal(this.route.data, { initialValue: this.route.snapshot.data });
  readonly catalog = computed(() => this.routeData()['catalog'] as CatalogPageData);

  search(value: string, category?: string): void {
    const keyword = value.trim();
    void this.router.navigate(['/products'], { queryParams: { keyword: keyword || null, category: category || null } });
  }
  updateControls(pageSize: string | number, sort: string): void {
    void this.router.navigate(['/products'], { queryParams: { ...this.route.snapshot.queryParams, pageSize, sort, page: null } });
  }
}
