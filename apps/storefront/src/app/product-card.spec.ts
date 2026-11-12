import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProductListItem } from './catalog-api';
import { ProductCard } from './product-card';

const product: ProductListItem = {
  id: '1', sku: null, slug: 'ao-dep', name: 'Áo thử nghiệm', shortDescription: null,
  description: null, brandName: null, priceMinor: 975000, currency: 'VND',
  website: { seoTitle: null, seoDescription: null, marketingDescription: null, isFeatured: false, displayOrder: 0 },
  primaryImage: { url: '/media/test.jpg', altText: 'Áo phía trước' }, sizes: ['S', 'Freesize'],
};

describe('ProductCard', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ProductCard], providers: [provideRouter([])] }));

  it('renders real product details and a product link', () => {
    const fixture = TestBed.createComponent(ProductCard);
    fixture.componentRef.setInput('product', product);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/products/ao-dep');
    expect(element.querySelector('img')?.getAttribute('src')).toBe('/media/test.jpg');
    expect(element.querySelector('img')?.getAttribute('alt')).toBe('Áo phía trước');
    expect(element.textContent).toContain('Áo thử nghiệm');
    expect(element.textContent).toContain('975.000 ₫');
    expect(element.textContent).toContain('S · Freesize');
  });

  it('shows an accessible fallback on error and recovers for a new image', () => {
    const fixture = TestBed.createComponent(ProductCard);
    fixture.componentRef.setInput('product', product);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('img').dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="img"]').getAttribute('aria-label')).toContain(product.name);
    fixture.componentRef.setInput('product', { ...product, primaryImage: { url: '/media/new.jpg', altText: null } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img').getAttribute('alt')).toBe(product.name);
  });

  it('omits unknown prices and unsafe images without inventing sizes', () => {
    const fixture = TestBed.createComponent(ProductCard);
    fixture.componentRef.setInput('product', { ...product, priceMinor: null, primaryImage: { url: '//evil.example/image', altText: null }, sizes: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('.price')).toBeNull();
    expect(fixture.nativeElement.querySelector('.sizes')).toBeNull();
    fixture.componentRef.setInput('product', { ...product, currency: 'USD' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.price')).toBeNull();
  });
});
