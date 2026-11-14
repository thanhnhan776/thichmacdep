import { Routes } from '@angular/router';
import { SampleProduct } from './sample-product';
import { AdminImport } from './admin-import';
import { ProductProof, resolveProductProof } from './product-proof';
import { CatalogPage, resolveCatalogPage } from './catalog-page';
import { ProductDetail, resolveProductDetail } from './product-detail';
import { StorefrontShell, resolveStorefrontShell } from './storefront-shell';
import { NotFound } from './not-found';

export const routes: Routes = [
  { path: '_internal/proof', component: ProductProof, resolve: { names: resolveProductProof }, runGuardsAndResolvers: 'paramsOrQueryParamsChange' },
  { path: '_internal/sample', component: SampleProduct },
  { path: 'admin', pathMatch: 'full', component: AdminImport, data: { section: 'home' } },
  { path: 'admin/products/new', component: AdminImport, data: { section: 'product-editor' } },
  { path: 'admin/products/:id/edit', component: AdminImport, data: { section: 'product-editor' } },
  { path: 'admin/products', pathMatch: 'full', component: AdminImport, data: { section: 'products' } },
  { path: 'admin/import', component: AdminImport, data: { section: 'import' } },
  { path: 'admin/administrators', component: AdminImport, data: { section: 'administrators' } },
  { path: '', component: StorefrontShell, resolve: { shellData: resolveStorefrontShell }, runGuardsAndResolvers: 'always', children: [
    { path: '', pathMatch: 'full', component: CatalogPage, resolve: { catalog: resolveCatalogPage }, runGuardsAndResolvers: 'paramsOrQueryParamsChange' },
    { path: 'products', pathMatch: 'full', component: CatalogPage, resolve: { catalog: resolveCatalogPage }, runGuardsAndResolvers: 'paramsOrQueryParamsChange' },
    { path: 'categories/:categorySlug', component: CatalogPage, resolve: { catalog: resolveCatalogPage }, runGuardsAndResolvers: 'paramsOrQueryParamsChange' },
    { path: 'products/:slug', component: ProductDetail, resolve: { productDetail: resolveProductDetail } },
  ] },
  { path: '**', component: NotFound },
];
