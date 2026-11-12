import { upsertCategory, upsertProduct } from '../apps/api/src/services/sync-repository.ts';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export default {
  async fetch(_request: Request, env: { DB: D1Database }): Promise<Response> {
    const db = env.DB;
    try {
      const parent = await upsertCategory(db, 'synthetic', { externalId: 'parent', name: 'Parent' });
      const child = await upsertCategory(db, 'synthetic', { externalId: 'child', name: 'Child', parentExternalId: 'parent' });
      check(child === await upsertCategory(db, 'synthetic', { externalId: 'child', name: 'Renamed' }), 'category ID changed');
      const category = await db.prepare('SELECT parent_id FROM categories WHERE id = ?').bind(child).first<{ parent_id: string }>();
      check(category?.parent_id === parent, 'parent not preserved');
      const product = await upsertProduct(db, 'synthetic', { externalId: '1', name: 'Same', sku: 'sku', description: 'description', priceMinor: 20 });
      await db.prepare("INSERT INTO website_product_settings (product_id, seo_title, created_at, updated_at) VALUES (?, 'owner', 'now', 'now')").bind(product).run();
      check(product === await upsertProduct(db, 'synthetic', { externalId: '1', name: 'Changed', sku: null }), 'product ID changed');
      const other = await upsertProduct(db, 'other', { externalId: '1', name: 'Same' });
      const row = await db.prepare('SELECT p.slug, p.sku, p.description, p.price_minor, w.seo_title FROM products p JOIN website_product_settings w ON w.product_id = p.id WHERE p.id = ?').bind(product).first<{ slug: string; sku: string | null; description: string; price_minor: number; seo_title: string }>();
      check(product !== other && row?.slug === 'same', 'identity or slug invalid');
      check((await db.prepare('SELECT slug FROM products WHERE id = ?').bind(other).first<{ slug: string }>())?.slug === 'same-2', 'provider collision not resolved');
      check(row.sku === null && row.description === 'description' && row.price_minor === 20 && row.seo_title === 'owner', 'field preservation failed');
      const relationships = async () => (await db.prepare('SELECT category_id FROM product_category WHERE product_id = ? ORDER BY category_id').bind(product).all<{ category_id: string }>()).results.map((item) => item.category_id).sort().join(',');
      const assigned = [parent, child].sort().join(',');
      await upsertProduct(db, 'synthetic', { externalId: '1', name: 'Assigned', categoryExternalIds: ['parent', 'child', 'parent'] });
      check(await relationships() === assigned, 'categories not assigned');
      await upsertProduct(db, 'synthetic', { externalId: '1', name: 'Replay', categoryExternalIds: ['parent', 'child'] });
      check(await relationships() === assigned, 'category replay changed relationships');
      await upsertProduct(db, 'synthetic', { externalId: '1', name: 'Preserved' });
      check(await relationships() === assigned, 'omitted categories not preserved');
      let missingRejected = false;
      try { await upsertProduct(db, 'synthetic', { externalId: '1', name: 'Must not persist', categoryExternalIds: ['parent', 'missing'] }); } catch { missingRejected = true; }
      check(missingRejected && await relationships() === assigned, 'missing category changed relationships');
      const unchanged = await db.prepare('SELECT name FROM products WHERE id = ?').bind(product).first<{ name: string }>();
      check(unchanged?.name === 'Preserved', 'missing category changed product');
      missingRejected = false;
      try { await upsertProduct(db, 'synthetic', { externalId: 'missing-category-product', name: 'Must not exist', categoryExternalIds: ['missing'] }); } catch { missingRejected = true; }
      const absent = await db.prepare("SELECT product_id FROM external_product_mappings WHERE provider = 'synthetic' AND external_id = 'missing-category-product'").first();
      check(missingRejected && !absent, 'missing category created product mapping');
      await upsertProduct(db, 'synthetic', { externalId: '1', name: 'Cleared', categoryExternalIds: [] });
      check(await relationships() === '', 'categories not cleared');
      const settings = await db.prepare('SELECT seo_title FROM website_product_settings WHERE product_id = ?').bind(product).first<{ seo_title: string }>();
      check(settings?.seo_title === 'owner', 'website settings changed');
      let rejected = false;
      try { await upsertProduct(db, 'synthetic', { externalId: 'invalid', name: 'Invalid', priceMinor: -1 }); } catch { rejected = true; }
      check(rejected, 'invalid record accepted');
      rejected = false;
      try { await upsertCategory(db, 'synthetic', { externalId: 'orphan', name: 'Orphan', parentExternalId: 'missing' }); } catch { rejected = true; }
      check(rejected, 'missing parent accepted');
      const count = await db.prepare("SELECT COUNT(*) AS count FROM categories WHERE name = 'Orphan'").first<{ count: number }>();
      check(count?.count === 0, 'failed category persisted');
      await db.prepare("INSERT INTO products (id, slug, name, created_at, updated_at) VALUES ('custom-slug-product', 'ao-dai', 'Custom', 'now', 'now')").run();
      await db.prepare("INSERT INTO categories (id, slug, name, created_at, updated_at) VALUES ('custom-slug-category', 'ao-dai', 'Custom', 'now', 'now')").run();
      const vietnamese = await upsertProduct(db, 'synthetic', { externalId: 'vietnamese', name: 'Áo dài' });
      const vietnameseCategory = await upsertCategory(db, 'synthetic', { externalId: 'vietnamese', name: 'Áo dài' });
      await upsertProduct(db, 'synthetic', { externalId: 'vietnamese', name: 'Same' });
      await upsertCategory(db, 'synthetic', { externalId: 'vietnamese', name: 'Parent' });
      check((await db.prepare('SELECT slug FROM products WHERE id = ?').bind(vietnamese).first<{ slug: string }>())?.slug === 'ao-dai-2', 'product slug changed on rename or custom collision');
      check((await db.prepare('SELECT slug FROM categories WHERE id = ?').bind(vietnameseCategory).first<{ slug: string }>())?.slug === 'ao-dai-2', 'category slug changed on rename or custom collision');
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
