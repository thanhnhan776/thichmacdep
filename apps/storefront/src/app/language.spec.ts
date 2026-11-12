import { TestBed } from '@angular/core/testing';
import { LanguageService } from './language';

describe('LanguageService', () => {
  afterEach(() => localStorage.removeItem('storefront-language'));

  it('defaults to Vietnamese, persists toggles, and restores English after rendering', async () => {
    localStorage.removeItem('storefront-language');
    TestBed.configureTestingModule({ providers: [LanguageService] });
    const language = TestBed.inject(LanguageService);
    expect(language.current()).toBe('vi');
    language.toggle();
    expect(language.current()).toBe('en');
    expect(localStorage.getItem('storefront-language')).toBe('en');
    TestBed.resetTestingModule();

    localStorage.setItem('storefront-language', 'en');
    TestBed.configureTestingModule({ providers: [LanguageService] });
    const restored = TestBed.inject(LanguageService);
    expect(restored.current()).toBe('vi');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(restored.current()).toBe('en');
  });

  it('formats prices with the active locale', () => {
    TestBed.configureTestingModule({ providers: [LanguageService] });
    const language = TestBed.inject(LanguageService);
    expect(language.formatPrice(120000)).toBe('120.000 ₫');
    language.set('en');
    expect(language.formatPrice(120000)).toBe('120,000 ₫');
  });
});
