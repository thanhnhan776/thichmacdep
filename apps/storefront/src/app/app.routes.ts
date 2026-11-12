import { Routes } from '@angular/router';
import { SampleProduct } from './sample-product';
import { AdminImport } from './admin-import';

export const routes: Routes = [
  { path: 'products/sample', component: SampleProduct },
  { path: 'admin/import', component: AdminImport },
];
