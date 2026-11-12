import { validateXlsxInput } from './xlsx-input.ts';
import { normalizeXlsxKey } from './xlsx-rows.ts';
import { xlsxCatalogSnapshot } from './xlsx-snapshot.ts';
import { xlsxSkuCollisions } from './xlsx-collisions.ts';
import { allocateSlug } from './slugs.ts';

const PROVIDER = 'xlsx:kiotviet';
const MAX_GROUPS = 100;
const MAX_ROWS = 400;
const MAX_IMAGES = 1000;

export interface XlsxImportResult { created: number; updated: number; }

/** Internal service only. The caller must authorize the request and limit its body. */
export async function applyXlsxImport(db: D1Database, rows: unknown, expectedDigest: string, expectedSnapshot: string): Promise<XlsxImportResult> {
  const { digest, preview } = await validateXlsxInput(rows);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || digest !== expectedDigest) throw new Error('XLSX digest mismatch');
  if (preview.errors.length) throw new Error('XLSX validation failed');
  if (preview.counts.rows > MAX_ROWS || preview.products.length > MAX_GROUPS ||
      preview.products.reduce((n, group) => n + group.variants.reduce((m, item) => m + item.images.length, 0), 0) > MAX_IMAGES) {
    throw new Error('XLSX import exceeds apply limits');
  }
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.prepare("INSERT INTO sync_runs (id, provider, trigger_type, started_at, status) VALUES (?, ?, 'xlsx', ?, 'running')")
      .bind(runId, PROVIDER, now).run();
  } catch {
    throw new Error('Unable to acquire XLSX import lock');
  }
  try {
    if (!/^[a-f0-9]{64}$/.test(expectedSnapshot) || await xlsxCatalogSnapshot(db, preview.products) !== expectedSnapshot) throw new Error('XLSX preview stale');
    if ((await xlsxSkuCollisions(db, preview.products)).errors.length) throw new Error('XLSX SKU group conflict');
    const statements: D1PreparedStatement[] = [];
    const seenProducts = new Set<string>();
    const productSlugs = new Set((await db.prepare('SELECT slug FROM products').all<{ slug: string }>()).results.map(row => row.slug));
    const categories = (await db.prepare('SELECT id, slug FROM categories').all<{ id: string; slug: string }>()).results;
    const categorySlugs = new Set(categories.map(row => row.slug));
    const categorySlugById = new Map(categories.map(row => [row.id, row.slug]));
    let created = 0;
    let updated = 0;
    for (const group of preview.products) {
      const key = normalizeXlsxKey(group.key);
      const mapping = await db.prepare('SELECT product_id FROM external_product_mappings WHERE provider = ? AND external_id = ?')
        .bind(PROVIDER, key).first<{ product_id: string }>();
      if (!mapping && await db.prepare('SELECT sku FROM xlsx_variant_mappings WHERE sku = ?').bind(key).first()) throw new Error('XLSX SKU group conflict');
      const productId = mapping?.product_id ?? crypto.randomUUID();
      if (seenProducts.has(productId)) throw new Error('XLSX SKU group conflict');
      seenProducts.add(productId);
      const first = group.variants[0];
      const categoryKey = normalizeXlsxKey(first.category);
      const categoryHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(categoryKey))), byte => byte.toString(16).padStart(2, '0')).join('');
      const categoryId = `xlsx-category-${categoryHash}`;
      if (mapping) {
        const state = await db.prepare('SELECT grouping_model, category_id FROM xlsx_product_state WHERE product_id = ?').bind(productId).first<{ grouping_model: string; category_id: string }>();
        if (!state || state.grouping_model !== (group.standalone ? 'standalone' : 'group')) throw new Error('XLSX SKU group conflict');
        // The join table has no independent ownership. Removing a link could
        // remove another source's relationship, so changes require resolution.
        if (state.category_id !== categoryId) throw new Error('XLSX category change requires manual resolution');
        updated++;
        statements.push(db.prepare('UPDATE xlsx_product_state SET version = version + 1 WHERE product_id = ?').bind(productId));
        statements.push(db.prepare('UPDATE products SET sku = ?, name = ?, brand_name = ?, price_minor = ?, is_active = ?, last_synced_at = ?, updated_at = ? WHERE id = ?')
          .bind(group.key, first.name, first.brand || null, first.price, Number(first.active && first.directSale), now, now, productId));
      } else {
        created++;
        const slug = allocateSlug(first.name, productSlugs);
        productSlugs.add(slug);
        statements.push(db.prepare('INSERT INTO products (id, sku, slug, name, brand_name, price_minor, is_active, last_synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(productId, group.key, slug, first.name, first.brand || null, first.price, Number(first.active && first.directSale), now, now, now));
        statements.push(db.prepare('INSERT INTO external_product_mappings (id, provider, external_id, product_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), PROVIDER, key, productId, now, now));
      }
      let categorySlug = categorySlugById.get(categoryId);
      if (categorySlug === undefined) {
        categorySlug = allocateSlug(first.category, categorySlugs);
        categorySlugs.add(categorySlug);
        categorySlugById.set(categoryId, categorySlug);
      }
      statements.push(db.prepare('INSERT INTO categories (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(categoryId, first.category, categorySlug, now, now));
      if (!mapping) statements.push(db.prepare('INSERT INTO xlsx_product_state (product_id, grouping_model, category_id) VALUES (?, ?, ?)')
        .bind(productId, group.standalone ? 'standalone' : 'group', categoryId));
      statements.push(db.prepare('INSERT INTO product_category (product_id, category_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(productId, categoryId));
      for (const item of group.variants) {
        const sku = normalizeXlsxKey(item.sku);
        const variant = await db.prepare('SELECT m.product_id, m.variant_id, v.product_id AS actual_product_id FROM xlsx_variant_mappings m LEFT JOIN product_variants v ON v.id = m.variant_id WHERE m.sku = ?')
          .bind(sku).first<{ product_id: string; variant_id: string; actual_product_id: string | null }>();
        if (variant && (variant.product_id !== productId || variant.actual_product_id !== productId)) throw new Error('XLSX SKU group conflict');
        const variantId = variant?.variant_id ?? crypto.randomUUID();
        const attributes = item.size === null ? null : JSON.stringify({ size: item.size });
        if (variant) {
          statements.push(db.prepare('UPDATE product_variants SET sku = ?, name = ?, attributes_json = ?, price_minor = ?, is_active = ? WHERE id = ? AND product_id = ?')
            .bind(item.sku, item.name, attributes, item.price, Number(item.active && item.directSale), variantId, productId));
        } else {
          statements.push(db.prepare('INSERT INTO product_variants (id, product_id, sku, name, attributes_json, price_minor, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(variantId, productId, item.sku, item.name, attributes, item.price, Number(item.active && item.directSale)));
          statements.push(db.prepare('INSERT INTO xlsx_variant_mappings (sku, product_id, variant_id) VALUES (?, ?, ?)').bind(sku, productId, variantId));
        }
      }
      // This runs after the variant writes in the same batch, including variants
      // omitted from a partial workbook and any independently managed variants.
      statements.push(db.prepare('UPDATE products SET is_active = EXISTS (SELECT 1 FROM product_variants WHERE product_id = ? AND is_active = 1) WHERE id = ?').bind(productId, productId));
      const urls = [...new Set(group.variants.flatMap(item => item.images))];
      const urlsJson = JSON.stringify(urls);
      // Delete only rows we created, and only when no other ownership record
      // references them. Never touch R2 objects or pre-existing editorial rows.
      statements.push(db.prepare(`DELETE FROM product_images WHERE id IN (
        SELECT image_id FROM xlsx_product_images WHERE product_id = ? AND created_by_xlsx = 1
        AND source_url NOT IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM xlsx_product_images other WHERE other.image_id = xlsx_product_images.image_id AND (other.product_id <> xlsx_product_images.product_id OR other.source_url <> xlsx_product_images.source_url))
      )`).bind(productId, urlsJson));
      statements.push(db.prepare('DELETE FROM xlsx_product_images WHERE product_id = ? AND source_url NOT IN (SELECT value FROM json_each(?))').bind(productId, urlsJson));
      for (const [position, url] of urls.entries()) {
        const imageId = crypto.randomUUID();
        statements.push(db.prepare('INSERT INTO product_images (id, product_id, source_url, position, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM product_images WHERE product_id = ? AND source_url = ?)')
          .bind(imageId, productId, url, position, now, now, productId, url));
        statements.push(db.prepare(`INSERT INTO xlsx_product_images (product_id, source_url, image_id, position, created_by_xlsx)
          SELECT ?, ?, id, ?, id = ? FROM product_images WHERE product_id = ? AND source_url = ? ORDER BY id = ? DESC, id LIMIT 1
          ON CONFLICT(product_id, source_url) DO UPDATE SET position = excluded.position`)
          .bind(productId, url, position, imageId, productId, url, imageId));
        statements.push(db.prepare(`UPDATE product_images SET position = ? WHERE id = (SELECT image_id FROM xlsx_product_images WHERE product_id = ? AND source_url = ? AND created_by_xlsx = 1)
          AND (SELECT COUNT(*) FROM xlsx_product_images WHERE image_id = product_images.id) = 1`).bind(position, productId, url));
      }
    }
    statements.push(db.prepare("UPDATE sync_runs SET status = 'completed', completed_at = ?, created_count = ?, updated_count = ?, skipped_count = ? WHERE id = ? AND status = 'running'")
      .bind(now, created, updated, preview.skipped.length, runId));
    await db.batch(statements);
    return { created, updated };
  } catch (error) {
    await db.prepare("UPDATE sync_runs SET status = 'failed', completed_at = ?, failed_count = 1, error_summary = 'XLSX import failed' WHERE id = ? AND status = 'running'")
      .bind(new Date().toISOString(), runId).run();
    if (error instanceof Error && ['XLSX SKU group conflict', 'XLSX preview stale', 'XLSX category change requires manual resolution'].includes(error.message)) throw error;
    throw new Error('XLSX import failed');
  }
}
