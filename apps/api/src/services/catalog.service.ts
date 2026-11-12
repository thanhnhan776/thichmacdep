import { publicImageUrl } from './image-url.ts';

/** Public catalog reads. Database errors are propagated to the caller. */
export interface ProductListInput {
  page: number;
  pageSize: number;
  keyword?: string;
  category?: string;
}

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

export interface ProductVariant {
  id: string;
  sku: string | null;
  name: string;
  attributesJson: string | null;
  priceMinor: number | null;
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
    conditions.push(`(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')`);
    args.push(pattern, pattern);
  }
  if (input.category) {
    conditions.push(`EXISTS (SELECT 1 FROM product_category pc JOIN categories c ON c.id = pc.category_id
      WHERE pc.product_id = p.id AND c.is_active = 1 AND c.slug = ?)`);
    args.push(input.category);
  }
  return { where: conditions.join(' AND '), args };
}

export async function listProducts(db: D1Database, input: ProductListInput): Promise<{ items: Product[]; total: number; page: number; pageSize: number }> {
  validatePagination(input.page, input.pageSize);
  const { where, args } = productFilters(input);
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT ${PRODUCT_FIELDS} ${PRODUCT_FROM} WHERE ${where}
      ORDER BY COALESCE(w.display_order, 0), p.name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`)
      .bind(...args, input.pageSize, (input.page - 1) * input.pageSize).all<ProductRow>(),
    db.prepare(`SELECT COUNT(*) AS total ${PRODUCT_FROM} WHERE ${where}`).bind(...args).first<{ total: number }>(),
  ]);
  return { items: rows.results.map(toProduct), total: count?.total ?? 0, page: input.page, pageSize: input.pageSize };
}

export async function getProductBySlug(db: D1Database, slug: string): Promise<ProductDetail | null> {
  const row = await db.prepare(`SELECT ${PRODUCT_FIELDS} ${PRODUCT_FROM} WHERE ${VISIBLE_PRODUCT} AND p.slug = ? LIMIT 1`)
    .bind(slug).first<ProductRow>();
  if (!row) return null;
  const [images, variants, categories] = await Promise.all([
    db.prepare(`SELECT id, source_url AS url, alt_text AS altText, position
      FROM product_images WHERE product_id = ? ORDER BY position, id`)
      .bind(row.id).all<{ id: string; url: string | null; altText: string | null; position: number }>(),
    db.prepare(`SELECT id, sku, name, attributes_json AS attributesJson, price_minor AS priceMinor
      FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE, id`)
      .bind(row.id).all<ProductVariant>(),
    db.prepare(`SELECT ${CATEGORY_FIELDS} FROM categories c JOIN product_category pc ON pc.category_id = c.id
      WHERE pc.product_id = ? AND c.is_active = 1 ORDER BY c.name COLLATE NOCASE, c.id`)
      .bind(row.id).all<Category>(),
  ]);
  const publicImages: ProductImage[] = [];
  for (const image of images.results) {
    const url = publicImageUrl(image.url);
    if (url) publicImages.push({ id: image.id, url, altText: image.altText, position: image.position });
  }
  return { ...toProduct(row), images: publicImages, variants: variants.results, categories: categories.results };
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
