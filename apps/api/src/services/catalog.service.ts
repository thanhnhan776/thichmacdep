import { publicImageUrl } from './image-url.ts';
import { normalizeSearchTerm } from './slugs.ts';
import { sortGarmentSizes } from '../../../shared/garment-sizes.ts';

/** Public catalog reads. Database errors are propagated to the caller. */
export interface ProductListInput {
  page: number;
  pageSize: number;
  keyword?: string;
  category?: string;
  sort?: ProductSort;
}
export type ProductSort = 'trending' | 'newest' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc';

export interface WebsiteProductSettings {
  seoTitle: string | null;
  seoDescription: string | null;
  marketingDescription: string | null;
  isFeatured: boolean;
  displayOrder: number;
}

export interface Product {
  id: string;
  sku: string | null;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  brandName: string | null;
  priceMinor: number | null;
  currency: string;
  website: WebsiteProductSettings;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

export interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
  position: number;
}

/** List images omit database identifiers and positions. Sizes come from active variants. */
export interface ProductListItem extends Product {
  primaryImage: { url: string; altText: string | null } | null;
  sizes: string[];
}

export interface ProductVariant {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  attributesJson: string | null;
  priceMinor: number | null;
  images: ProductImage[];
}

export interface ProductDetail extends Product {
  images: ProductImage[];
  variants: ProductVariant[];
  categories: Category[];
}

export interface StoreSettings {
  storeName: string;
  defaultCurrency: string;
  tiktokUrl: string | null;
  instagramUrl: string | null;
  zaloUrl: string | null;
  messengerUrl: string | null;
  otherContactUrl: string | null;
  logoUrl: string | null;
}

type ProductRow = Omit<Product, 'website'> & {
  seoTitle: string | null;
  seoDescription: string | null;
  marketingDescription: string | null;
  isFeatured: number;
  displayOrder: number;
};

const PRODUCT_FIELDS = `p.id, p.sku, p.slug, p.name,
  p.short_description AS shortDescription, p.description, p.brand_name AS brandName,
  p.price_minor AS priceMinor, p.currency,
  w.seo_title AS seoTitle, w.seo_description AS seoDescription,
  w.marketing_description AS marketingDescription,
  COALESCE(w.is_featured, 0) AS isFeatured, COALESCE(w.display_order, 0) AS displayOrder`;
const PRODUCT_FROM = `FROM products p LEFT JOIN website_product_settings w ON w.product_id = p.id`;
const VISIBLE_PRODUCT = `p.is_active = 1 AND COALESCE(w.is_hidden, 0) = 0`;
const CATEGORY_FIELDS = `c.id, c.name, c.slug, c.parent_id AS parentId`;

function toProduct(row: ProductRow): Product {
  const { seoTitle, seoDescription, marketingDescription, isFeatured, displayOrder, ...product } = row;
  return { ...product, website: { seoTitle, seoDescription, marketingDescription, isFeatured: Boolean(isFeatured), displayOrder } };
}

function validatePagination(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger((page - 1) * pageSize)) {
    throw new RangeError('Invalid pagination: page must be positive and pageSize must be between 1 and 100');
  }
}

function productFilters(input: ProductListInput): { where: string; args: string[] } {
  const conditions = [VISIBLE_PRODUCT];
  const args: string[] = [];
  if (input.keyword) {
    const pattern = `%${input.keyword.replace(/[\\%_]/g, '\\$&')}%`;
    // SQLite's built-in LIKE is ASCII-case-insensitive, but neither case-folds
    // Unicode reliably nor removes Vietnamese tone marks. Slugs already use
    // the same accent-folding rules, so use them as a second searchable form.
    const normalized = normalizeSearchTerm(input.keyword);
    conditions.push(`(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\'${normalized ? " OR p.slug LIKE ? ESCAPE '\\'" : ''})`);
    args.push(pattern, pattern, ...(normalized ? [`%${normalized.replace(/[\\%_]/g, '\\$&')}%`] : []));
  }
  if (input.category) {
    conditions.push(`EXISTS (SELECT 1 FROM product_category pc JOIN categories c ON c.id = pc.category_id
      WHERE pc.product_id = p.id AND c.is_active = 1 AND c.slug = ?)`);
    args.push(input.category);
  }
  return { where: conditions.join(' AND '), args };
}

export async function listProducts(db: D1Database, input: ProductListInput, imageBase?: string, allowLocal = false): Promise<{ items: ProductListItem[]; total: number; page: number; pageSize: number }> {
  validatePagination(input.page, input.pageSize);
  const sort = input.sort ?? 'trending';
  const orders: Record<ProductSort, string> = {
    trending: 'p.is_trending DESC, CASE WHEN p.is_trending = 1 THEN p.trending_sort_order END ASC, CASE WHEN p.is_trending = 0 THEN p.created_at END DESC, p.id ASC',
    newest: 'p.created_at DESC, p.id ASC',
    'price-asc': 'p.price_minor IS NULL, p.price_minor ASC, p.id ASC',
    'price-desc': 'p.price_minor IS NULL, p.price_minor DESC, p.id ASC',
    'name-asc': 'p.name COLLATE NOCASE ASC, p.id ASC',
    'name-desc': 'p.name COLLATE NOCASE DESC, p.id ASC',
  };
  if (!(sort in orders)) throw new RangeError('Invalid sort');
  const { where, args } = productFilters(input);
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT ${PRODUCT_FIELDS} ${PRODUCT_FROM} WHERE ${where}
      ORDER BY ${orders[sort]} LIMIT ? OFFSET ?`)
      .bind(...args, input.pageSize, (input.page - 1) * input.pageSize).all<ProductRow>(),
    db.prepare(`SELECT COUNT(*) AS total ${PRODUCT_FROM} WHERE ${where}`).bind(...args).first<{ total: number }>(),
  ]);
  const items: ProductListItem[] = rows.results.map((row) => ({ ...toProduct(row), primaryImage: null, sizes: [] }));
  if (items.length) {
    const ids = items.map((item) => item.id);
    const placeholders = ids.map(() => '?').join(', ');
    const [images, variants] = await Promise.all([
      db.prepare(`SELECT product_id AS productId, source_url AS url, alt_text AS altText
        FROM product_images WHERE product_id IN (${placeholders}) ORDER BY product_id, position, id`)
        .bind(...ids).all<{ productId: string; url: string | null; altText: string | null }>(),
      db.prepare(`SELECT product_id AS productId, attributes_json AS attributesJson
        FROM product_variants WHERE product_id IN (${placeholders}) AND is_active = 1
        ORDER BY product_id, name COLLATE NOCASE, id`)
        .bind(...ids).all<{ productId: string; attributesJson: string | null }>(),
    ]);
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const image of images.results) {
      const item = byId.get(image.productId);
      const url = publicImageUrl(image.url, imageBase, allowLocal);
      if (item && !item.primaryImage && url) item.primaryImage = { url, altText: image.altText };
    }
    for (const variant of variants.results) {
      const item = byId.get(variant.productId);
      if (!item || !variant.attributesJson) continue;
      try {
        const attributes: unknown = JSON.parse(variant.attributesJson);
        if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) continue;
        const size: unknown = (attributes as Record<string, unknown>).size;
        if (typeof size === 'string' && size.trim() && !item.sizes.includes(size.trim())) item.sizes.push(size.trim());
      } catch {
        // Malformed provider attributes are not public size information.
      }
    }
    for (const item of items) item.sizes = sortGarmentSizes(item.sizes);
  }
  return { items, total: count?.total ?? 0, page: input.page, pageSize: input.pageSize };
}

export async function getProductBySlug(db: D1Database, slug: string, imageBase?: string, allowLocal = false): Promise<ProductDetail | null> {
  const row = await db.prepare(`SELECT ${PRODUCT_FIELDS} ${PRODUCT_FROM} WHERE ${VISIBLE_PRODUCT} AND p.slug = ? LIMIT 1`)
    .bind(slug).first<ProductRow>();
  if (!row) return null;
  const [images, variants, categories, assignments] = await Promise.all([
    db.prepare(`SELECT id, source_url AS url, alt_text AS altText, position
      FROM product_images WHERE product_id = ? ORDER BY position, id`)
      .bind(row.id).all<{ id: string; url: string | null; altText: string | null; position: number }>(),
    db.prepare(`SELECT id, sku, name, description, attributes_json AS attributesJson, price_minor AS priceMinor
      FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE, id`)
      .bind(row.id).all<Omit<ProductVariant, 'images'>>(),
    db.prepare(`SELECT ${CATEGORY_FIELDS} FROM categories c JOIN product_category pc ON pc.category_id = c.id
      WHERE pc.product_id = ? AND c.is_active = 1 ORDER BY c.name COLLATE NOCASE, c.id`)
      .bind(row.id).all<Category>(),
    db.prepare(`SELECT v.variant_id AS variantId, v.image_id AS imageId
      FROM product_variant_images v
      JOIN product_variants pv ON pv.id = v.variant_id
      JOIN product_images i ON i.id = v.image_id AND i.product_id = pv.product_id
      WHERE pv.product_id = ? AND pv.is_active = 1 ORDER BY v.variant_id, v.position, i.id`)
      .bind(row.id).all<{ variantId: string; imageId: string }>(),
  ]);
  const publicImages: ProductImage[] = [];
  for (const image of images.results) {
    const url = publicImageUrl(image.url, imageBase, allowLocal);
    if (url) publicImages.push({ id: image.id, url, altText: image.altText, position: image.position });
  }
  const imagesById = new Map(publicImages.map(image => [image.id, image]));
  const assigned = new Map<string, ProductImage[]>();
  for (const assignment of assignments.results) {
    const list = assigned.get(assignment.variantId) ?? [];
    const image = imagesById.get(assignment.imageId);
    if (image) list.push(image);
    assigned.set(assignment.variantId, list);
  }
  return { ...toProduct(row), images: publicImages, variants: variants.results.map(variant => ({
    ...variant, images: assigned.get(variant.id) ?? publicImages,
  })), categories: categories.results };
}

export async function listCategories(db: D1Database): Promise<Category[]> {
  const result = await db.prepare(`SELECT ${CATEGORY_FIELDS} FROM categories c WHERE c.is_active = 1
    ORDER BY c.name COLLATE NOCASE, c.id`).all<Category>();
  return result.results;
}

export async function getCategoryBySlug(db: D1Database, slug: string): Promise<Category | null> {
  return db.prepare(`SELECT ${CATEGORY_FIELDS} FROM categories c WHERE c.is_active = 1 AND c.slug = ? LIMIT 1`)
    .bind(slug).first<Category>();
}

export async function getStoreSettings(db: D1Database): Promise<StoreSettings | null> {
  return db.prepare(`SELECT store_name AS storeName, default_currency AS defaultCurrency,
    tiktok_url AS tiktokUrl, instagram_url AS instagramUrl, zalo_url AS zaloUrl,
    messenger_url AS messengerUrl, other_contact_url AS otherContactUrl, logo_url AS logoUrl
    FROM store_settings WHERE id = ? LIMIT 1`).bind('default').first<StoreSettings>();
}
