import { sql } from 'drizzle-orm';
import { type AnySQLiteColumn, check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const localSmokeChecks = sqliteTable('local_smoke_checks', {
  id: text('id').primaryKey(),
  value: text('value').notNull(),
});

// Provision explicitly before sign-in; Google must verify the email before linking the subject.
export const adminUsers = sqliteTable('admin_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  googleSub: text('google_sub'),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('admin_users_email_unique').on(table.email),
  uniqueIndex('admin_users_google_sub_unique').on(table.googleSub),
  check('admin_users_email_normalized', sql`${table.email} = lower(trim(${table.email})) AND ${table.email} GLOB '*@gmail.com' AND length(${table.email}) > length('@gmail.com') AND instr(${table.email}, '@') = length(${table.email}) - length('@gmail.com') + 1`),
  check('admin_users_role_valid', sql`${table.role} IN ('admin', 'user')`),
  check('admin_users_enabled_valid', sql`${table.isEnabled} IN (0, 1)`),
  check('admin_users_google_sub_nonempty', sql`${table.googleSub} IS NULL OR length(${table.googleSub}) > 0`),
]);

// Store only a cryptographic hash of the bearer token, never the token itself.
export const adminSessions = sqliteTable('admin_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
}, (table) => [
  uniqueIndex('admin_sessions_token_hash_unique').on(table.tokenHash),
  index('admin_sessions_user_idx').on(table.userId),
  index('admin_sessions_expires_idx').on(table.expiresAt),
]);

// One-time login challenges are stored hashed and consumed atomically.
export const adminLoginChallenges = sqliteTable('admin_login_challenges', {
  nonceHash: text('nonce_hash').primaryKey(),
  expiresAt: text('expires_at').notNull(),
});

// All timestamps are UTC ISO-8601 text supplied by the application.
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  sku: text('sku'),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  shortDescription: text('short_description'),
  description: text('description'),
  brandName: text('brand_name'),
  priceMinor: integer('price_minor'),
  currency: text('currency').notNull().default('VND'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sourceUpdatedAt: text('source_updated_at'),
  lastSyncedAt: text('last_synced_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('products_slug_unique').on(table.slug),
  index('products_sku_idx').on(table.sku),
  index('products_active_idx').on(table.isActive),
  index('products_name_idx').on(table.name),
  check('products_price_minor_nonnegative', sql`${table.priceMinor} IS NULL OR (typeof(${table.priceMinor}) = 'integer' AND ${table.priceMinor} >= 0)`),
]);

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  parentId: text('parent_id').references((): AnySQLiteColumn => categories.id),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sourceUpdatedAt: text('source_updated_at'),
  lastSyncedAt: text('last_synced_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('categories_slug_unique').on(table.slug),
  index('categories_parent_idx').on(table.parentId),
  check('categories_not_own_parent', sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
]);

// Local catalog flexibility does not imply anything about provider relationships.
export const productCategories = sqliteTable('product_category', {
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.productId, table.categoryId] }),
  index('product_category_category_idx').on(table.categoryId),
]);

export const productImages = sqliteTable('product_images', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sourceUrl: text('source_url').notNull(),
  r2Key: text('r2_key'),
  altText: text('alt_text'),
  position: integer('position').notNull().default(0),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes'),
  etag: text('etag'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('product_images_product_position_idx').on(table.productId, table.position),
  check('product_images_size_nonnegative', sql`${table.sizeBytes} IS NULL OR (typeof(${table.sizeBytes}) = 'integer' AND ${table.sizeBytes} >= 0)`),
]);

// Only rows created by XLSX may be removed by XLSX; reused editorial rows
// remain owned by their original source. Position also records source order.
export const xlsxProductImages = sqliteTable('xlsx_product_images', {
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sourceUrl: text('source_url').notNull(),
  imageId: text('image_id').notNull().references(() => productImages.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  createdByXlsx: integer('created_by_xlsx', { mode: 'boolean' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.productId, table.sourceUrl] }),
  index('xlsx_product_images_image_idx').on(table.imageId),
  check('xlsx_product_images_owned_valid', sql`${table.createdByXlsx} IN (0, 1)`),
]);

// Variant fields remain optional where provider support is not yet known.
export const productVariants = sqliteTable('product_variants', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  externalVariantId: text('external_variant_id'),
  sku: text('sku'),
  name: text('name').notNull(),
  attributesJson: text('attributes_json'),
  priceMinor: integer('price_minor'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
}, (table) => [
  index('product_variants_product_idx').on(table.productId),
  check('product_variants_price_minor_nonnegative', sql`${table.priceMinor} IS NULL OR (typeof(${table.priceMinor}) = 'integer' AND ${table.priceMinor} >= 0)`),
]);

export const externalProductMappings = sqliteTable('external_product_mappings', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  externalVariantId: text('external_variant_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('external_product_mappings_provider_external_unique').on(table.provider, table.externalId),
  index('external_product_mappings_product_idx').on(table.productId),
]);

// XLSX SKUs are normalized independently of the product grouping key.
export const xlsxVariantMappings = sqliteTable('xlsx_variant_mappings', {
  sku: text('sku').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  variantId: text('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
}, (table) => [uniqueIndex('xlsx_variant_mappings_variant_unique').on(table.variantId)]);

// Existing mappings without this provenance are ambiguous and must not be adopted.
export const xlsxProductState = sqliteTable('xlsx_product_state', {
  productId: text('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  groupingModel: text('grouping_model', { enum: ['standalone', 'group'] }).notNull(),
  categoryId: text('category_id').notNull().references(() => categories.id),
  version: integer('version').notNull().default(1),
}, (table) => [check('xlsx_product_state_model_valid', sql`${table.groupingModel} IN ('standalone', 'group')`)]);

export const externalCategoryMappings = sqliteTable('external_category_mappings', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  categoryId: text('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('external_category_mappings_provider_external_unique').on(table.provider, table.externalId),
  index('external_category_mappings_category_idx').on(table.categoryId),
]);

export const websiteProductSettings = sqliteTable('website_product_settings', {
  productId: text('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  marketingDescription: text('marketing_description'),
  isFeatured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
  displayOrder: integer('display_order').notNull().default(0),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const storeSettings = sqliteTable('store_settings', {
  id: text('id').primaryKey(),
  storeName: text('store_name').notNull(),
  defaultCurrency: text('default_currency').notNull().default('VND'),
  tiktokUrl: text('tiktok_url'),
  instagramUrl: text('instagram_url'),
  zaloUrl: text('zalo_url'),
  messengerUrl: text('messenger_url'),
  otherContactUrl: text('other_contact_url'),
  logoUrl: text('logo_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const syncRuns = sqliteTable('sync_runs', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  triggerType: text('trigger_type').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  status: text('status').notNull(),
  createdCount: integer('created_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  deactivatedCount: integer('deactivated_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  errorSummary: text('error_summary'),
  cursor: text('cursor'),
  watermark: text('watermark'),
}, (table) => [
  uniqueIndex('sync_runs_provider_running_unique').on(table.provider).where(sql`${table.status} = 'running'`),
]);

export const syncEvents = sqliteTable('sync_events', {
  id: text('id').primaryKey(),
  syncRunId: text('sync_run_id').notNull().references(() => syncRuns.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  message: text('message'),
  createdAt: text('created_at').notNull(),
}, (table) => [index('sync_events_run_idx').on(table.syncRunId)]);
