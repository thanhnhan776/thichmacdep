import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { SampleProduct } from './sample-product';

describe('storefront', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    });
  });

  it('renders the sample product route', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/products/sample', SampleProduct);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Sample product');
  });
});
