import { normalizeXlsxKey, type ImportProduct } from './xlsx-rows.ts';
import { xlsxSkuCollisions } from './xlsx-collisions.ts';

/** One statement gives a consistent D1 read snapshot. Include collisions as well
 * as all source variants and associations of mapped products. */
export async function xlsxCatalogSnapshot(db: D1Database, products: ImportProduct[]): Promise<string> {
  const keys = JSON.stringify(products.map(p => normalizeXlsxKey(p.key)));
  const skus = JSON.stringify(products.flatMap(p => [normalizeXlsxKey(p.key), ...p.variants.map(v => normalizeXlsxKey(v.sku))]));
  const result = await db.prepare(`
    WITH keys AS (SELECT value FROM json_each(?)), skus AS (SELECT value FROM json_each(?)),
    relevant AS (
      SELECT product_id FROM external_product_mappings WHERE provider = 'xlsx:kiotviet' AND external_id IN keys
      UNION SELECT product_id FROM xlsx_variant_mappings WHERE sku IN skus
    ) SELECT json_object(
      'mapping', (SELECT json_group_array(value) FROM (SELECT json_array(id, provider, external_id, product_id, external_variant_id, created_at, updated_at) AS value FROM external_product_mappings WHERE (provider = 'xlsx:kiotviet' AND external_id IN keys) OR product_id IN relevant ORDER BY value)),
      'product', (SELECT json_group_array(value) FROM (SELECT json_array(id, sku, slug, name, short_description, description, brand_name, price_minor, currency, is_active, source_updated_at, last_synced_at, created_at, updated_at) AS value FROM products WHERE id IN relevant ORDER BY value)),
      'state', (SELECT json_group_array(value) FROM (SELECT json_array(product_id, grouping_model, category_id, version) AS value FROM xlsx_product_state WHERE product_id IN relevant ORDER BY value)),
      'variant_mapping', (SELECT json_group_array(value) FROM (SELECT json_array(sku, product_id, variant_id) AS value FROM xlsx_variant_mappings WHERE product_id IN relevant OR sku IN skus ORDER BY value)),
      'variant', (SELECT json_group_array(value) FROM (SELECT json_array(id, product_id, external_variant_id, sku, name, description, attributes_json, price_minor, is_active) AS value FROM product_variants WHERE product_id IN relevant ORDER BY value)),
      'variant_images', (SELECT json_group_array(value) FROM (SELECT json_array(v.variant_id, v.image_id, v.position) AS value FROM product_variant_images v JOIN product_variants pv ON pv.id = v.variant_id WHERE pv.product_id IN relevant ORDER BY v.variant_id, v.position, v.image_id)),
      'category', (SELECT json_group_array(value) FROM (SELECT json_array(product_id, category_id) AS value FROM product_category WHERE product_id IN relevant ORDER BY value)),
      'images', (SELECT json_group_array(value) FROM (SELECT json_array(id, product_id, source_url, r2_key, alt_text, position, content_type, size_bytes, etag, created_at, updated_at) AS value FROM product_images WHERE product_id IN relevant ORDER BY value)),
      'xlsx_images', (SELECT json_group_array(value) FROM (SELECT json_array(product_id, source_url, image_id, position, created_by_xlsx) AS value FROM xlsx_product_images WHERE product_id IN relevant ORDER BY value))
    ) AS snapshot`).bind(keys, skus).all();
  const collisions = await xlsxSkuCollisions(db, products);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([result.results, collisions.records])));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
