import type { ExternalCategory, ExternalProduct } from '../integrations/provider.ts';
import { allocateSlug } from './slugs.ts';

type Scalar = string | number | null;
type Field = { column: string; value: Scalar };

function required(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
}

function optionalText(value: unknown, field: string): void {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new TypeError(`${field} must be text or null`);
}

function common(provider: string, record: { externalId: string; name: string; isActive?: boolean; sourceUpdatedAt?: string | null }): void {
  required(provider, 'provider');
  required(record?.externalId, 'externalId');
  required(record?.name, 'name');
  if (record.isActive !== undefined && typeof record.isActive !== 'boolean') throw new TypeError('isActive must be boolean');
  optionalText(record.sourceUpdatedAt, 'sourceUpdatedAt');
  if (record.sourceUpdatedAt != null && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(record.sourceUpdatedAt) || !Number.isFinite(Date.parse(record.sourceUpdatedAt)))) throw new TypeError('sourceUpdatedAt must be a UTC timestamp');
}

function add(fields: Field[], column: string, value: Scalar | boolean | undefined): void {
  if (value !== undefined) fields.push({ column, value: typeof value === 'boolean' ? Number(value) : value });
}

/** Each entity and its mapping are written in one D1 transaction. */
async function upsert(db: D1Database, provider: string, externalId: string, kind: 'product' | 'category', fields: Field[], parentExternalId?: string | null, categoryIds?: string[]): Promise<string> {
  const entity = kind === 'product' ? 'products' : 'categories';
  const mapping = `external_${kind}_mappings`;
  const foreignKey = `${kind}_id`;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const existing = await db.prepare(`SELECT e.slug FROM ${mapping} m JOIN ${entity} e ON e.id = m.${foreignKey} WHERE m.provider = ? AND m.external_id = ?`)
    .bind(provider, externalId).first<{ slug: string }>();
  const used = existing ? null : await db.prepare(`SELECT slug FROM ${entity}`).all<{ slug: string }>();
  const slug = existing?.slug ?? allocateSlug(fields[0].value as string, new Set(used!.results.map(row => row.slug)));
  const columns = fields.map((field) => field.column);
  const values = fields.map((field) => field.value);
  const parentColumn = kind === 'category' && parentExternalId !== undefined;
  // An unresolved parent deliberately violates the foreign key rather than silently dropping it.
  const parentExpression = parentExternalId === null ? 'NULL' : `COALESCE((SELECT category_id FROM external_category_mappings WHERE provider = ? AND external_id = ?), '')`;
  const insert = db.prepare(`INSERT INTO ${entity} (id, slug, ${columns.join(', ')}, ${parentColumn ? 'parent_id, ' : ''}created_at, updated_at, last_synced_at)
    VALUES (COALESCE((SELECT ${foreignKey} FROM ${mapping} WHERE provider = ? AND external_id = ?), ?), COALESCE((SELECT e.slug FROM ${mapping} m JOIN ${entity} e ON e.id = m.${foreignKey} WHERE m.provider = ? AND m.external_id = ?), ?), ${columns.map(() => '?').join(', ')}, ${parentColumn ? `${parentExpression}, ` : ''}?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET ${columns.map((column) => `${column} = excluded.${column}`).join(', ')}, ${parentColumn ? 'parent_id = excluded.parent_id, ' : ''}updated_at = excluded.updated_at, last_synced_at = excluded.last_synced_at`)
    .bind(provider, externalId, id, provider, externalId, slug, ...values, ...(parentColumn && parentExternalId !== null ? [provider, parentExternalId] : []), now, now, now);
  const map = db.prepare(`INSERT INTO ${mapping} (id, provider, external_id, ${foreignKey}, created_at, updated_at)
    VALUES (?, ?, ?, COALESCE((SELECT ${foreignKey} FROM ${mapping} WHERE provider = ? AND external_id = ?), ?), ?, ?)
    ON CONFLICT(provider, external_id) DO UPDATE SET updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), provider, externalId, provider, externalId, id, now, now);
  const lookup = db.prepare(`SELECT ${foreignKey} AS id FROM ${mapping} WHERE provider = ? AND external_id = ?`).bind(provider, externalId);
  const statements = [insert, map];
  if (categoryIds !== undefined) {
    statements.push(db.prepare('DELETE FROM product_category WHERE product_id = (SELECT product_id FROM external_product_mappings WHERE provider = ? AND external_id = ?)').bind(provider, externalId));
    for (const categoryId of new Set(categoryIds)) {
      statements.push(db.prepare('INSERT INTO product_category (product_id, category_id) VALUES ((SELECT product_id FROM external_product_mappings WHERE provider = ? AND external_id = ?), ?)').bind(provider, externalId, categoryId));
    }
  }
  statements.push(lookup);
  const results = await db.batch<{ id: string }>(statements);
  const resolved = results[results.length - 1].results[0]?.id;
  if (!resolved) throw new Error('Mapping was not persisted');
  return resolved;
}

/** Unsupported collections fail closed instead of silently discarding provider data. */
export async function upsertProduct(db: D1Database, provider: string, product: ExternalProduct): Promise<string> {
  common(provider, product);
  if (product.images !== undefined || product.variants !== undefined) throw new Error('Product relationship sync is not supported');
  const fields: Field[] = [{ column: 'name', value: product.name }];
  for (const [column, value] of [['sku', product.sku], ['short_description', product.shortDescription], ['description', product.description], ['brand_name', product.brandName], ['source_updated_at', product.sourceUpdatedAt]] as const) {
    optionalText(value, column);
    add(fields, column, value);
  }
  if (product.priceMinor !== undefined && product.priceMinor !== null && (!Number.isSafeInteger(product.priceMinor) || product.priceMinor < 0)) throw new TypeError('priceMinor must be a nonnegative integer or null');
  if (product.currency !== undefined) required(product.currency, 'currency');
  add(fields, 'price_minor', product.priceMinor);
  add(fields, 'currency', product.currency);
  add(fields, 'is_active', product.isActive);
  let categoryIds: string[] | undefined;
  if (product.categoryExternalIds !== undefined) {
    if (!Array.isArray(product.categoryExternalIds)) throw new TypeError('categoryExternalIds must be an array');
    categoryIds = [];
    for (const externalId of new Set(product.categoryExternalIds)) {
      required(externalId, 'categoryExternalId');
      const category = await db.prepare('SELECT category_id AS id FROM external_category_mappings WHERE provider = ? AND external_id = ?').bind(provider, externalId).first<{ id: string }>();
      if (!category) throw new Error(`Unknown category mapping: ${externalId}`);
      categoryIds.push(category.id);
    }
  }
  return upsert(db, provider, product.externalId, 'product', fields, undefined, categoryIds);
}

export async function upsertCategory(db: D1Database, provider: string, category: ExternalCategory): Promise<string> {
  common(provider, category);
  if (category.parentExternalId !== undefined && category.parentExternalId !== null) required(category.parentExternalId, 'parentExternalId');
  const fields: Field[] = [{ column: 'name', value: category.name }];
  add(fields, 'is_active', category.isActive);
  add(fields, 'source_updated_at', category.sourceUpdatedAt);
  return upsert(db, provider, category.externalId, 'category', fields, category.parentExternalId);
}
