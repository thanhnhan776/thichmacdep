import { ChangeDetectionStrategy, Component, computed, inject, input, RESPONSE_INIT, signal } from '@angular/core';
import { ResolveFn, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CatalogApi, type Category, type StoreSettings } from './catalog-api';
import { LanguageService } from './language';

export type ShellData = { categories: Category[]; settings: StoreSettings | null; error: false } | { error: true };

export const resolveStorefrontShell: ResolveFn<ShellData> = async () => {
  const api = inject(CatalogApi);
  const response = inject(RESPONSE_INIT, { optional: true });
  try {
    const [categories, settings] = await Promise.all([api.categories(), api.storeSettings()]);
    return { categories, settings, error: false };
  } catch {
    if (response) response.status = 500;
    return { error: true };
  }
};

@Component({
  selector: 'app-storefront-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './storefront-shell.html',
  styleUrl: './storefront-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorefrontShell {
  readonly language = inject(LanguageService);
  readonly shellData = input<ShellData>();
  readonly categoriesInput = input<readonly Category[]>([], { alias: 'categories' });
  readonly settingsInput = input<StoreSettings | null>(null, { alias: 'settings' });
  readonly categories = computed(() => { const data = this.shellData(); return data && !data.error ? data.categories : this.categoriesInput() ?? []; });
  readonly settings = computed(() => { const data = this.shellData(); return data && !data.error ? data.settings : this.settingsInput() ?? null; });
  readonly menuOpen = signal(false);
  readonly categoriesOpen = signal(false);

  readonly contacts = computed(() => {
    const settings = this.settings();
    if (!settings) return [];
    const entries = [
      [this.language.text().tikTok, settings.tiktokUrl],
      [this.language.text().instagram, settings.instagramUrl],
      [this.language.text().zalo, settings.zaloUrl],
      [this.language.text().messenger, settings.messengerUrl],
      [this.language.text().otherContact, settings.otherContactUrl],
    ] as const;
    return entries.flatMap(([label, value]) => {
      if (!value || value !== value.trim()) return [];
      try {
        const url = new URL(value);
        return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password
          ? [{ label, url: url.href }] : [];
      } catch {
        return [];
      }
    });
  });

  closeMenus(): void {
    this.menuOpen.set(false);
    this.categoriesOpen.set(false);
  }
}
