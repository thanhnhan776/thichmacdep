import { normalizeXlsxKey, type ImportIssue, type ImportProduct } from './xlsx-rows.ts';

/** SQLite's lower() does not implement the Unicode normalization used by XLSX.
 * Read SKU identities and compare in JavaScript using exactly the same folding. */
export async function xlsxSkuCollisions(db: D1Database, products: ImportProduct[]): Promise<{ records: unknown[]; errors: ImportIssue[] }> {
  const result = await db.prepare(`SELECT 'product' AS kind, p.id, p.sku, m.external_id AS mapping, NULL AS product_id
    FROM products p LEFT JOIN external_product_mappings m ON m.product_id = p.id AND m.provider = 'xlsx:kiotviet'
    WHERE p.sku IS NOT NULL OR m.external_id IS NOT NULL
    UNION ALL
    SELECT 'variant', v.id, v.sku, m.sku, v.product_id FROM product_variants v
    LEFT JOIN xlsx_variant_mappings m ON m.variant_id = v.id AND m.product_id = v.product_id
    WHERE v.sku IS NOT NULL OR m.sku IS NOT NULL
    ORDER BY kind, id, mapping`).all<{ kind: string; id: string; sku: string | null; mapping: string | null; product_id: string | null }>();
  const entries = result.results;
  const keys = new Set(products.flatMap(group => [normalizeXlsxKey(group.key), ...group.variants.map(item => normalizeXlsxKey(item.sku))]));
  const records = entries.filter(entry => entry.sku !== null && keys.has(normalizeXlsxKey(entry.sku)));
  const errors: ImportIssue[] = [];
  for (const group of products) {
    const key = normalizeXlsxKey(group.key);
    const productIds = new Set(entries.filter(entry => entry.kind === 'product' && entry.mapping === key).map(entry => entry.id));
    for (const target of [{ sku: key, row: group.variants[0].row }, ...group.variants.map(item => ({ sku: normalizeXlsxKey(item.sku), row: item.row }))]) {
      const collision = records.some(entry => {
        if (entry.sku === null || normalizeXlsxKey(entry.sku) !== target.sku) return false;
        if (entry.kind === 'product') return !productIds.has(entry.id);
        return !entry.product_id || !productIds.has(entry.product_id) || entry.mapping !== target.sku;
      });
      if (collision && !errors.some(error => error.row === target.row)) errors.push({ row: target.row, column: 'Mã hàng', reason: 'SKU conflicts with an existing catalog product or variant; manual resolution required' });
    }
  }
  return { records, errors };
}
