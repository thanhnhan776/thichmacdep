import { validateXlsxInput } from './xlsx-input.ts';
import { normalizeXlsxKey, type ImportIssue, type ImportPreview } from './xlsx-rows.ts';
import { xlsxCatalogSnapshot } from './xlsx-snapshot.ts';
import { xlsxSkuCollisions } from './xlsx-collisions.ts';

const PROVIDER = 'xlsx:kiotviet';
// D1 permits a limited number of bound parameters per statement.
const KEYS_PER_QUERY = 90;

export interface XlsxServerPreview {
  digest: string;
  catalogSnapshot: string;
  counts: ImportPreview['counts'] & { creates: number; updates: number; images: number };
  errors: ImportIssue[];
  skipped: ImportIssue[];
}

/** Read-only identity estimate, not authorization to apply an import. Mapping
 * external IDs for this provider must be stored as normalizeXlsxKey(group key).
 * Existing mappings are counted as updates, not compared for changed fields. */
export async function previewXlsxImport(db: D1Database, rows: unknown): Promise<XlsxServerPreview> {
  const { digest, preview } = await validateXlsxInput(rows);
  const keys = preview.products.map(product => normalizeXlsxKey(product.key));
  let updates = 0;
  try {
    for (let offset = 0; offset < keys.length; offset += KEYS_PER_QUERY) {
      const batch = keys.slice(offset, offset + KEYS_PER_QUERY);
      const placeholders = batch.map(() => '?').join(', ');
      const result = await db.prepare(
        `SELECT COUNT(*) AS count FROM external_product_mappings WHERE provider = ? AND external_id IN (${placeholders})`,
      ).bind(PROVIDER, ...batch).first<{ count: number }>();
      if (!result || !Number.isInteger(result.count)) throw new Error('Invalid count');
      updates += result.count;
    }
  } catch {
    // Database errors may contain bound values; never propagate them to callers.
    throw new Error('Unable to preview XLSX mappings');
  }
  return {
    digest,
    catalogSnapshot: await xlsxCatalogSnapshot(db, preview.products),
    counts: { ...preview.counts, creates: keys.length - updates, updates,
      images: preview.products.reduce((n, group) => n + group.variants.reduce((m, item) => m + item.images.length, 0), 0) },
    errors: [...preview.errors, ...(await xlsxSkuCollisions(db, preview.products)).errors],
    skipped: preview.skipped,
  };
}
