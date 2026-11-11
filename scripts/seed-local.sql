-- Local-only synthetic fixtures. Apply migrations first. Existing rows, especially
-- website-owned settings, are deliberately left untouched on subsequent runs.
INSERT OR IGNORE INTO categories (id, name, slug, parent_id, is_active, created_at, updated_at) VALUES
  ('cat-clothing', 'Clothing', 'clothing', NULL, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat-tops', 'Tops', 'tops', 'cat-clothing', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat-bottoms', 'Bottoms', 'bottoms', 'cat-clothing', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat-accessories', 'Accessories', 'accessories', NULL, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT OR IGNORE INTO products (id, sku, slug, name, short_description, brand_name, price_minor, currency, is_active, created_at, updated_at) VALUES
  ('prod-linen-shirt', 'TOP-LINEN-01', 'linen-shirt', 'Linen Shirt', 'A light everyday shirt.', 'Fixture Studio', 350000, 'VND', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('prod-cotton-tee', 'TOP-COTTON-02', 'cotton-tee', 'Cotton Tee', 'A simple cotton tee.', 'Fixture Studio', 190000, 'VND', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('prod-wide-trousers', 'BTM-WIDE-03', 'wide-trousers', 'Wide Trousers', 'Relaxed fit trousers.', 'Fixture Studio', 420000, 'VND', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('prod-hidden-bag', 'ACC-BAG-04', 'hidden-bag', 'Canvas Bag', 'A hidden website fixture.', 'Fixture Studio', 120000, 'VND', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('prod-inactive-hat', 'ACC-HAT-05', 'inactive-hat', 'Cotton Hat', 'An inactive catalog fixture.', 'Fixture Studio', 150000, 'VND', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT OR IGNORE INTO product_category (product_id, category_id) VALUES
  ('prod-linen-shirt', 'cat-tops'),
  ('prod-linen-shirt', 'cat-clothing'),
  ('prod-cotton-tee', 'cat-tops'),
  ('prod-wide-trousers', 'cat-bottoms'),
  ('prod-hidden-bag', 'cat-accessories'),
  ('prod-inactive-hat', 'cat-accessories');

INSERT OR IGNORE INTO product_variants (id, product_id, sku, name, attributes_json, price_minor, is_active) VALUES
  ('variant-linen-shirt-m', 'prod-linen-shirt', 'TOP-LINEN-01-M', 'Medium', '{"size":"M"}', 350000, 1),
  ('variant-linen-shirt-l', 'prod-linen-shirt', 'TOP-LINEN-01-L', 'Large', '{"size":"L"}', 350000, 1);

INSERT OR IGNORE INTO product_images (id, product_id, source_url, r2_key, alt_text, position, created_at, updated_at) VALUES
  ('image-linen-shirt', 'prod-linen-shirt', 'https://images.example.invalid/private-source-sentinel.jpg', 'private-r2-key-sentinel.jpg', 'Linen shirt', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT OR IGNORE INTO external_product_mappings (id, provider, external_id, product_id, created_at, updated_at) VALUES
  ('mapping-linen-shirt', 'fixture-provider', 'external-1001', 'prod-linen-shirt', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('mapping-cotton-tee', 'fixture-provider', 'external-1002', 'prod-cotton-tee', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('mapping-wide-trousers', 'fixture-provider', 'external-1003', 'prod-wide-trousers', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT OR IGNORE INTO website_product_settings (product_id, seo_title, seo_description, marketing_description, is_featured, display_order, is_hidden, created_at, updated_at) VALUES
  ('prod-linen-shirt', 'Linen Shirt | Fixture Store', 'A light linen shirt.', 'A versatile everyday layer.', 1, 10, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('prod-cotton-tee', NULL, NULL, NULL, 0, 20, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('prod-wide-trousers', NULL, NULL, NULL, 1, 30, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('prod-hidden-bag', NULL, NULL, NULL, 0, 40, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('prod-inactive-hat', NULL, NULL, NULL, 0, 50, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT OR IGNORE INTO store_settings (id, store_name, default_currency, created_at, updated_at) VALUES
  ('default', 'Fixture Store', 'VND', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
