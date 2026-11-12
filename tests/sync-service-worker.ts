import { runInitialSync } from '../apps/api/src/services/sync.service.ts';
import type { CatalogProvider } from '../apps/api/src/integrations/provider.ts';

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export default {
  async fetch(_request: Request, { DB: db }: { DB: D1Database }): Promise<Response> {
    try {
      let fail = false;
      const provider: CatalogProvider = {
        async listCategories({ continuation }) {
          return continuation ? { items: [{ externalId: 'parent', name: 'Parent' }], nextContinuation: null } :
            { items: [{ externalId: 'child', name: 'Child', parentExternalId: 'parent' }], nextContinuation: 'next' };
        },
        async listProducts({ continuation }) {
          if (continuation && fail) throw new Error('secret-token-sensitive-details');
          return continuation ? { items: [{ externalId: 'two', name: 'Two' }], nextContinuation: null } :
            { items: [{ externalId: 'one', name: 'One', categoryExternalIds: ['child'] }], nextContinuation: 'next' };
        },
        async getProduct() { throw new Error('Unexpected call'); },
      };
      const options = { db, provider, providerName: 'synthetic', clock: () => new Date('2026-01-01T00:00:00Z') };
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const empty: CatalogProvider = { ...provider,
        async listCategories() { return { items: [], nextContinuation: null }; },
        async listProducts() { return { items: [], nextContinuation: null }; },
      };
      const blocking: CatalogProvider = { ...empty, async listCategories() {
        entered();
        await blocked;
        return { items: [], nextContinuation: null };
      } };
      const concurrentOptions = { ...options, provider: blocking, providerName: 'concurrency-test' };
      const first = runInitialSync(concurrentOptions);
      await started;
      try {
        let acquisitionMessage = '';
        try { await runInitialSync(concurrentOptions); } catch (error) { acquisitionMessage = String(error); }
        check(acquisitionMessage === 'Error: Unable to start initial sync', 'overlap was not safely rejected');
        await runInitialSync({ ...options, provider: empty, providerName: 'other-provider' });
        const running = await db.prepare("SELECT COUNT(*) AS count FROM sync_runs WHERE provider = 'concurrency-test' AND status = 'running'").first<{ count: number }>();
        check(running?.count === 1, 'first run lost its lock');
      } finally {
        release();
        await first;
      }
      await runInitialSync({ ...concurrentOptions, provider: empty });
      const completed = await db.prepare("SELECT COUNT(*) AS count FROM sync_runs WHERE provider = 'concurrency-test' AND status = 'completed'").first<{ count: number }>();
      check(completed?.count === 2, 'completed runs did not release the lock');
      await runInitialSync(options);
      const product = await db.prepare("SELECT product_id AS id FROM external_product_mappings WHERE external_id = 'one'").first<{ id: string }>();
      check(product, 'product missing');
      await db.prepare("INSERT INTO website_product_settings (product_id, seo_title, created_at, updated_at) VALUES (?, 'owner', 'now', 'now')").bind(product.id).run();
      const hierarchy = await db.prepare("SELECT parent.external_id AS parent FROM external_category_mappings child JOIN categories c ON c.id = child.category_id JOIN external_category_mappings parent ON parent.category_id = c.parent_id WHERE child.external_id = 'child'").first<{ parent: string }>();
      check(hierarchy?.parent === 'parent', 'hierarchy missing');
      fail = true;
      let message = '';
      try { await runInitialSync(options); } catch (error) { message = String(error); }
      check(message.includes('failed') && !message.includes('secret'), 'failure leaked or not reported');
      const failed = await db.prepare("SELECT status, failed_count, error_summary, cursor, watermark FROM sync_runs WHERE status = 'failed'").first<{ status: string; failed_count: number; error_summary: string; cursor: string | null; watermark: string | null }>();
      check(failed?.failed_count === 1 && !failed.error_summary.includes('secret') && failed.cursor === null && failed.watermark === null, 'failure record invalid');
      fail = false;
      await runInitialSync(options);
      const row = await db.prepare("SELECT p.id, p.is_active, w.seo_title FROM products p JOIN website_product_settings w ON w.product_id = p.id WHERE p.id = ?").bind(product.id).first<{ id: string; is_active: number; seo_title: string }>();
      check(row?.id === product.id && row.is_active === 1 && row.seo_title === 'owner', 'replay changed owner data');
      const counts = await db.prepare("SELECT COUNT(*) AS count FROM external_product_mappings WHERE provider = 'synthetic'").first<{ count: number }>();
      check(counts?.count === 2, 'duplicate or missing products');
      const second = await db.prepare("SELECT p.is_active FROM products p JOIN external_product_mappings m ON m.product_id = p.id WHERE m.external_id = 'two'").first<{ is_active: number }>();
      check(second?.is_active === 1, 'failure deactivated product');
      const orphan: CatalogProvider = { ...provider, async listCategories() { return { items: [{ externalId: 'orphan', name: 'Orphan', parentExternalId: 'missing' }], nextContinuation: null }; } };
      let rejected = false;
      try { await runInitialSync({ ...options, provider: orphan }); } catch { rejected = true; }
      check(rejected, 'orphan hierarchy accepted');
      const looping: CatalogProvider = { ...provider, async listCategories() { return { items: [], nextContinuation: 'loop' }; } };
      rejected = false;
      try { await runInitialSync({ ...options, provider: looping, maxPages: 3 }); } catch { rejected = true; }
      check(rejected, 'pagination loop accepted');
      const invalid: CatalogProvider = { ...provider, async listProducts() { return { items: [{ externalId: 'invalid', name: 'Invalid', priceMinor: -1 }], nextContinuation: null }; } };
      rejected = false;
      try { await runInitialSync({ ...options, provider: invalid }); } catch { rejected = true; }
      check(rejected, 'invalid record accepted');
      const duplicate: CatalogProvider = { ...provider, async listProducts({ continuation }) {
        return continuation ? { items: [{ externalId: 'secret-duplicate', name: 'Second' }], nextContinuation: null } :
          { items: [{ externalId: 'secret-duplicate', name: 'First' }], nextContinuation: 'next' };
      } };
      message = '';
      try { await runInitialSync({ ...options, provider: duplicate, providerName: 'duplicate-test' }); } catch (error) { message = String(error); }
      check(message === 'Error: Initial sync failed during products', 'duplicate failure not sanitized');
      const duplicateRun = await db.prepare("SELECT status, failed_count, error_summary FROM sync_runs WHERE provider = 'duplicate-test'").first<{ status: string; failed_count: number; error_summary: string }>();
      check(duplicateRun?.status === 'failed' && duplicateRun.failed_count === 1 && duplicateRun.error_summary === 'Initial sync failed during products', 'duplicate failure record invalid');
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
