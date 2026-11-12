import type { CatalogProvider, ExternalCategory, ProviderPage, ProviderPageInput } from '../integrations/provider.ts';
import { upsertCategory, upsertProduct } from './sync-repository.ts';

export interface InitialSyncOptions {
  db: D1Database;
  provider: CatalogProvider;
  providerName: string;
  clock: () => Date;
  maxPages?: number;
}

/** Run a replayable initial import. Failure messages intentionally omit provider data. */
export async function runInitialSync({ db, provider, providerName, clock, maxPages = 10000 }: InitialSyncOptions): Promise<string> {
  if (!providerName.trim() || !Number.isSafeInteger(maxPages) || maxPages < 1) throw new TypeError('Invalid sync configuration');
  const id = crypto.randomUUID();
  let created = 0;
  let updated = 0;
  let stage = 'categories';
  try {
    await db.prepare("INSERT INTO sync_runs (id, provider, trigger_type, started_at, status) VALUES (?, ?, 'initial', ?, 'running')")
      .bind(id, providerName, clock().toISOString()).run();
  } catch {
    throw new Error('Unable to start initial sync');
  }

  async function pages<T>(fetchPage: (input: ProviderPageInput) => Promise<ProviderPage<T>>, consume: (items: T[]) => Promise<void>): Promise<void> {
    const seen = new Set<string>();
    let continuation: string | undefined;
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      const page = await fetchPage(continuation === undefined ? {} : { continuation });
      if (!page || !Array.isArray(page.items) || (page.nextContinuation !== null && (typeof page.nextContinuation !== 'string' || !page.nextContinuation))) throw new Error('Invalid page');
      await consume(page.items);
      if (page.nextContinuation === null) return;
      if (seen.has(page.nextContinuation)) throw new Error('Pagination loop');
      seen.add(page.nextContinuation);
      continuation = page.nextContinuation;
    }
    throw new Error('Pagination limit');
  }

  async function exists(kind: 'category' | 'product', externalId: string): Promise<boolean> {
    const row = await db.prepare(`SELECT 1 AS present FROM external_${kind}_mappings WHERE provider = ? AND external_id = ?`).bind(providerName, externalId).first();
    return !!row;
  }

  try {
    const categories = new Map<string, ExternalCategory>();
    await pages((input) => provider.listCategories(input), async (items) => {
      for (const category of items) {
        if (!category || typeof category.externalId !== 'string' || !category.externalId.trim() || categories.has(category.externalId)) throw new Error('Invalid category');
        categories.set(category.externalId, category);
      }
    });
    const done = new Set<string>();
    while (done.size < categories.size) {
      let progress = false;
      for (const [externalId, category] of categories) {
        if (done.has(externalId)) continue;
        if (category.parentExternalId != null && !done.has(category.parentExternalId)) continue;
        const existing = await exists('category', externalId);
        await upsertCategory(db, providerName, category);
        if (existing) updated++; else created++;
        done.add(externalId);
        progress = true;
      }
      if (!progress) throw new Error('Unresolved category hierarchy');
    }
    stage = 'products';
    const productIds = new Set<string>();
    await pages((input) => provider.listProducts(input), async (items) => {
      for (const product of items) {
        if (!product || typeof product.externalId !== 'string' || !product.externalId.trim() || productIds.has(product.externalId)) throw new Error('Invalid product');
        productIds.add(product.externalId);
        const existing = await exists('product', product.externalId);
        await upsertProduct(db, providerName, product);
        if (existing) updated++; else created++;
      }
    });
    await db.prepare("UPDATE sync_runs SET status = 'completed', completed_at = ?, created_count = ?, updated_count = ? WHERE id = ?")
      .bind(clock().toISOString(), created, updated, id).run();
    return id;
  } catch {
    await db.prepare("UPDATE sync_runs SET status = 'failed', completed_at = ?, created_count = ?, updated_count = ?, failed_count = 1, error_summary = ? WHERE id = ?")
      .bind(clock().toISOString(), created, updated, `Initial sync failed during ${stage}`, id).run();
    throw new Error(`Initial sync failed during ${stage}`);
  }
}
