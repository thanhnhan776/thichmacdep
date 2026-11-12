import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProductListItem } from './catalog-api';
import { LanguageService } from './language';

@Component({
  selector: 'app-product-card',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-card.html',
  styleUrl: './product-card.css',
})
export class ProductCard {
  readonly language = inject(LanguageService);
  readonly product = input.required<ProductListItem>();
  private readonly failedImage = signal<string | null>(null);

  readonly imageUrl = computed(() => {
    const url = this.product().primaryImage?.url.trim();
    if (!url || this.failedImage() === url) return null;
    // Allow root-relative media and ordinary web URLs, but not protocol-relative URLs.
    if (/^\/(?![\/\\])/.test(url) || /^https?:\/\//i.test(url)) return url;
    return null;
  });

  readonly price = computed(() => {
    const { priceMinor, currency } = this.product();
    if (currency.toUpperCase() !== 'VND' || priceMinor === null || !Number.isSafeInteger(priceMinor) || priceMinor < 0) return null;
    return this.language.formatPrice(priceMinor);
  });

  imageFailed(url: string): void {
    this.failedImage.set(url);
  }
}
