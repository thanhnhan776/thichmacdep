import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StorefrontShell } from './storefront-shell';
import type { StoreSettings } from './catalog-api';

describe('StorefrontShell', () => {
  const settings: StoreSettings = {
    storeName: 'Example Studio', defaultCurrency: 'VND', logoUrl: null,
    tiktokUrl: null, instagramUrl: 'https://instagram.com/example', zaloUrl: 'javascript:alert(1)',
    messengerUrl: 'https://user:pass@example.com/', otherContactUrl: 'not a url',
  };

  beforeEach(() => TestBed.configureTestingModule({ imports: [StorefrontShell], providers: [provideRouter([])] }));

  it('renders only supplied categories and safe configured contact links', () => {
    const fixture = TestBed.createComponent(StorefrontShell);
    fixture.componentRef.setInput('settings', settings);
    fixture.componentRef.setInput('categories', [{ id: '1', name: 'Linen', slug: 'linen', parentId: null }]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.header .wordmark')?.getAttribute('aria-label')).toBe('Thích Mặc Đẹp');
    expect(root.textContent).toContain('Linen');
    expect(root.querySelector('footer a[href*="category=linen"]')).toBeTruthy();
    expect(root.querySelectorAll('a[href="https://instagram.com/example"]').length).toBe(2);
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(root.textContent).not.toContain('Messenger');
  });

  it('toggles the accessible navigation and category disclosure', () => {
    const fixture = TestBed.createComponent(StorefrontShell);
    fixture.componentRef.setInput('categories', [{ id: '1', name: 'Linen', slug: 'linen', parentId: null }]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const menu = root.querySelector<HTMLButtonElement>('.menu-toggle')!;
    const categories = root.querySelector<HTMLButtonElement>('.category-menu button')!;
    menu.click(); categories.click(); fixture.detectChanges();
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(categories.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('#storefront-categories a')?.textContent).toContain('Linen');
    root.querySelector('nav')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(categories.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not invent contact links or categories when data is absent', () => {
    const fixture = TestBed.createComponent(StorefrontShell);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.category-menu')).toBeNull();
    expect(root.querySelector('.contact-link')).toBeNull();
    expect(root.querySelector('footer')?.textContent).not.toContain('Contact');
    expect(root.querySelector('router-outlet')).toBeTruthy();
  });

  it('exposes localized navigation and a working language toggle', () => {
    const fixture = TestBed.createComponent(StorefrontShell);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const toggle = root.querySelector<HTMLButtonElement>('.language-toggle button[aria-label="English"]')!;
    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('Danh mục điều hướng');
    toggle.click(); fixture.detectChanges();
    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('Main navigation');
    expect(root.querySelector('.language-toggle button[aria-label="English"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});
