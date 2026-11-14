import { applyXlsxImport } from '../apps/api/src/services/xlsx-import.ts';
import { validateXlsxInput } from '../apps/api/src/services/xlsx-input.ts';
import { previewXlsxImport } from '../apps/api/src/services/xlsx-preview.ts';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function testSyntheticWorkbook(db: D1Database) {
  const rows: Record<string, string | boolean>[] = [];
  let imageNumber = 0;
  const addGood = (sku: string, name: string, category: string, size: string) => {
    const imageCount = rows.length < 10 ? 2 : 3;
    const urls = Array.from({ length: imageCount }, () =>
      `https://cdn-images.kiotviet.vn/synthetic-workbook-${++imageNumber}.jpg`);
    rows.push({
      'Loại hàng': 'Hàng hóa', 'Mã hàng': sku, 'Tên hàng': name,
      'Nhóm hàng(3 Cấp)': category, 'Thương hiệu': 'Synthetic Brand', 'Giá bán': '100000',
      'Đang kinh doanh': true, 'Được bán trực tiếp': true,
      'Hình ảnh (url1,url2...)': urls.join(','), 'Thuộc tính': size ? `SIZE: ${size}` : '',
    });
  };
  for (let group = 0; group < 55; group++) {
    for (const size of ['S', 'M', 'L']) {
      addGood(`SYNTH-G${group}-${size}`, `Synthetic group ${group}`, `Synthetic category ${group % 5}`, size);
    }
  }
  for (let item = 0; item < 18; item++) {
    addGood(`SYNTH-ONE${item}`, `Synthetic standalone ${item}`, `Synthetic category ${item % 5}`, '');
  }
  // Suffix-only size family infers dimensions when the attribute cell is blank.
  for (const size of ['S', 'M', 'L']) addGood(`SYNTH-QD2-${size}`, `Synthetic suffix family - ${size}`, 'Synthetic category 0', '');
  for (let service = 0; service < 2; service++) {
    rows.push({ 'Loại hàng': 'Dịch vụ', 'Mã hàng': `SYNTH-SERVICE${service}`, 'Thuộc tính': '' });
  }
  check(imageNumber === 548, 'synthetic URL count');
  const preview = await previewXlsxImport(db, rows);
  check(preview.errors.length === 0 && preview.skipped.length === 2, 'synthetic preview validation');
  check(preview.counts.rows === 188 && preview.counts.goods === 186 && preview.counts.services === 2 &&
    preview.counts.products === 74 && preview.counts.creates === 74 && preview.counts.updates === 0 &&
    preview.counts.images === 548, 'synthetic preview counts');
  const created = await applyXlsxImport(db, rows, preview.digest, preview.catalogSnapshot);
  check(created.created === 74 && created.updated === 0, 'synthetic create counts');
  const mappings = async () => (await db.prepare("SELECT sku, product_id, variant_id FROM xlsx_variant_mappings WHERE sku LIKE 'synth-%' ORDER BY sku").all<{ sku: string; product_id: string; variant_id: string }>()).results;
  const initial = await mappings();
  check(initial.length === 186 && new Set(initial.map(item => item.variant_id)).size === 186 &&
    new Set(initial.map(item => item.product_id)).size === 74, 'synthetic mapping counts');
  check(new Set(initial.filter(item => item.sku.startsWith('synth-qd2-')).map(item => item.product_id)).size === 1,
    'suffix-only S/M/L family not grouped');
  const inferred = await db.prepare("SELECT v.attributes_json, p.name FROM xlsx_variant_mappings m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = m.product_id WHERE m.sku LIKE 'synth-qd2-%' ORDER BY m.sku").all<{ attributes_json: string; name: string }>();
  check(inferred.results.map(item => JSON.parse(item.attributes_json).size).sort().join(',') === 'L,M,S' &&
    inferred.results.every(item => item.name === 'Synthetic suffix family'), 'inferred sizes or group name not persisted');
  const partial = rows.filter(item => item['Mã hàng'] === 'SYNTH-QD2-M');
  const partialPreview = await previewXlsxImport(db, partial);
  check(partialPreview.errors.length > 0, 'unsafe partial inferred family accepted');
  let partialRejected = false;
  try { await applyXlsxImport(db, partial, partialPreview.digest, partialPreview.catalogSnapshot); } catch { partialRejected = true; }
  check(partialRejected, 'unsafe partial inferred family applied');
  check(new Set(initial.filter(item => item.sku.startsWith('synth-one')).map(item => item.product_id)).size === 18,
    'standalone products with similar labels were grouped');
  for (let group = 0; group < 55; group++) {
    const variants = initial.filter(item => item.sku.startsWith(`synth-g${group}-`));
    check(variants.length === 3 && new Set(variants.map(item => item.product_id)).size === 1, 'synthetic size grouping');
  }
  const counts = async () => db.prepare("SELECT (SELECT COUNT(*) FROM product_variants WHERE id IN (SELECT variant_id FROM xlsx_variant_mappings WHERE sku LIKE 'synth-%')) AS variants, (SELECT COUNT(*) FROM product_images WHERE product_id IN (SELECT product_id FROM xlsx_variant_mappings WHERE sku LIKE 'synth-%')) AS images").first<{ variants: number; images: number }>();
  const before = await counts();
  check(before?.variants === 186 && before.images === 548, 'synthetic persisted counts');
  const replayPreview = await previewXlsxImport(db, rows);
  check(replayPreview.errors.length === 0 && replayPreview.skipped.length === 2 &&
    replayPreview.counts.creates === 0 && replayPreview.counts.updates === 74 && replayPreview.counts.images === 548,
    'synthetic replay preview');
  const replay = await applyXlsxImport(db, rows, replayPreview.digest, replayPreview.catalogSnapshot);
  check(replay.created === 0 && replay.updated === 74, 'synthetic replay counts');
  check(JSON.stringify(initial) === JSON.stringify(await mappings()), 'synthetic replay identity changed');
  const after = await counts();
  check(after?.variants === 186 && after.images === 548, 'synthetic replay persisted counts');
}

async function testSlugs(db: D1Database) {
  await db.prepare("INSERT INTO products (id, slug, name, created_at, updated_at) VALUES ('slug-custom-product', 'ao-dai', 'Custom', 'now', 'now')").run();
  await db.prepare("INSERT INTO categories (id, slug, name, created_at, updated_at) VALUES ('slug-custom-category', 'thoi-trang', 'Custom', 'now', 'now')").run();
  const row = {
    'Loại hàng': 'Hàng hóa', 'Mã hàng': 'SLUG-ONE', 'Tên hàng': 'Áo dài',
    'Nhóm hàng(3 Cấp)': 'Thời trang', 'Giá bán': '100',
    'Đang kinh doanh': true, 'Được bán trực tiếp': true, 'Thuộc tính': '',
    'Hình ảnh (url1,url2...)': 'https://cdn-images.kiotviet.vn/slug-test.jpg',
  };
  const rows = [row, { ...row, 'Mã hàng': 'SLUG-TWO' }, { ...row, 'Mã hàng': 'SLUG-THREE', 'Nhóm hàng(3 Cấp)': 'Thoi trang' }];
  const apply = async (input: typeof rows) => {
    const preview = await previewXlsxImport(db, input);
    check(preview.errors.length === 0, 'slug test preview failed');
    await applyXlsxImport(db, input, preview.digest, preview.catalogSnapshot);
  };
  await apply(rows);
  const products = async () => (await db.prepare("SELECT m.external_id, p.slug FROM external_product_mappings m JOIN products p ON p.id = m.product_id WHERE m.provider = 'xlsx:kiotviet' AND m.external_id LIKE 'slug-%' ORDER BY m.external_id").all<{ external_id: string; slug: string }>()).results;
  const before = await products();
  check(before.map(item => item.slug).sort().join(',') === 'ao-dai-2,ao-dai-3,ao-dai-4', 'batch product slugs incorrect');
  const categories = await db.prepare("SELECT c.slug, COUNT(*) AS count FROM categories c JOIN product_category pc ON pc.category_id = c.id JOIN external_product_mappings m ON m.product_id = pc.product_id WHERE m.external_id LIKE 'slug-%' GROUP BY c.id ORDER BY c.slug").all<{ slug: string; count: number }>();
  check(categories.results.length === 2 && categories.results[0].slug === 'thoi-trang-2' && categories.results[0].count === 2 && categories.results[1].slug === 'thoi-trang-3', 'category slug reservation incorrect');
  await apply(rows.map(item => ({ ...item, 'Tên hàng': 'Tên khác' })));
  check(JSON.stringify(before) === JSON.stringify(await products()), 'product slug changed on reimport');
}

export default {
  async fetch(_request: Request, { DB: db }: { DB: D1Database }): Promise<Response> {
    try {
      const row = {
        'Loại hàng': 'Hàng hóa', 'Mã hàng': 'DEMO-M', 'Tên hàng': 'Example',
        'Nhóm hàng(3 Cấp)': 'Category', 'Thương hiệu': 'Brand', 'Giá bán': '100',
        'Đang kinh doanh': true, 'Được bán trực tiếp': true,
        'Hình ảnh (url1,url2...)': 'https://cdn-images.kiotviet.vn/example.jpg', 'Thuộc tính': 'SIZE: M',
      };
      const rows = [row, { ...row, 'Mã hàng': 'DEMO-L', 'Thuộc tính': 'SIZE: L' },
        { ...row, 'Mã hàng': 'OTHER', 'Thuộc tính': '' }];
      const digest = (await validateXlsxInput(rows)).digest;
      const snapshot = async (input: unknown) => (await previewXlsxImport(db, input)).catalogSnapshot;
      const created = await applyXlsxImport(db, rows, digest, await snapshot(rows));
      check(created.created === 2 && created.updated === 0, 'create counts');
      const mappings = await db.prepare('SELECT sku, product_id, variant_id FROM xlsx_variant_mappings ORDER BY sku').all<{ sku: string; product_id: string; variant_id: string }>();
      check(mappings.results.length === 3 && mappings.results[0].product_id === mappings.results[1].product_id, 'grouping');
      const productId = mappings.results[0].product_id;
      const baseline = await snapshot(rows);
      check(baseline === await snapshot(rows), 'unchanged snapshot differs');
      await db.prepare('UPDATE product_variants SET is_active = 1 - is_active WHERE id = ?').bind(mappings.results[0].variant_id).run();
      check(baseline !== await snapshot(rows), 'variant change did not invalidate snapshot');
      await db.prepare('UPDATE product_variants SET is_active = 1 - is_active WHERE id = ?').bind(mappings.results[0].variant_id).run();
      check(baseline === await snapshot(rows), 'restored variant changed snapshot');
      await db.prepare("INSERT INTO website_product_settings (product_id, seo_title, is_hidden, created_at, updated_at) VALUES (?, 'Owner', 1, 'now', 'now')").bind(productId).run();
      await db.prepare("UPDATE product_images SET r2_key = 'keep' WHERE product_id = ?").bind(productId).run();
      const beforeDescription = await previewXlsxImport(db, rows);
      await db.prepare('UPDATE product_variants SET description = ? WHERE id = ?').bind('Editorial variant', mappings.results[0].variant_id).run();
      let descriptionStale = false;
      try { await applyXlsxImport(db, rows, beforeDescription.digest, beforeDescription.catalogSnapshot); } catch (error) { descriptionStale = String(error).includes('stale'); }
      check(descriptionStale, 'variant description change accepted stale preview');
      const replay = await applyXlsxImport(db, rows, digest, await snapshot(rows));
      check(replay.updated === 2 && replay.created === 0, 'replay counts');
      const editorialVariant = await db.prepare('SELECT description FROM product_variants WHERE id = ?').bind(mappings.results[0].variant_id).first<{ description: string | null }>();
      check(editorialVariant?.description === 'Editorial variant', 'reimport changed variant description');
      const again = await db.prepare('SELECT sku, product_id, variant_id FROM xlsx_variant_mappings ORDER BY sku').all();
      check(JSON.stringify(mappings.results) === JSON.stringify(again.results), 'identity changed');
      const image = await db.prepare('SELECT COUNT(*) AS count, MIN(r2_key) AS r2 FROM product_images WHERE product_id = ?').bind(productId).first<{ count: number; r2: string }>();
      check(image?.count === 1 && image.r2 === 'keep', 'image replay');
      const assignedImage = await db.prepare('SELECT id FROM product_images WHERE product_id = ?').bind(productId).first<{ id: string }>();
      check(assignedImage, 'image to assign missing');
      const beforeAssignment = await previewXlsxImport(db, rows);
      await db.prepare('INSERT INTO product_variant_images (variant_id, image_id, position) VALUES (?, ?, ?)').bind(mappings.results[0].variant_id, assignedImage.id, 0).run();
      let assignmentStale = false;
      try { await applyXlsxImport(db, rows, beforeAssignment.digest, beforeAssignment.catalogSnapshot); } catch (error) { assignmentStale = String(error).includes('stale'); }
      check(assignmentStale, 'variant image assignment accepted stale preview');
      const assignedSnapshot = await snapshot(rows);
      await db.prepare('UPDATE product_variant_images SET position = 1 WHERE variant_id = ? AND image_id = ?').bind(mappings.results[0].variant_id, assignedImage.id).run();
      check(assignedSnapshot !== await snapshot(rows), 'variant image order did not invalidate snapshot');
      const settings = await db.prepare('SELECT seo_title, is_hidden FROM website_product_settings WHERE product_id = ?').bind(productId).first<{ seo_title: string; is_hidden: number }>();
      check(settings?.seo_title === 'Owner' && settings.is_hidden === 1, 'website settings changed');
      const editorialUrl = 'https://cdn-images.kiotviet.vn/editorial.jpg';
      const newUrl = 'https://cdn-images.kiotviet.vn/replacement.jpg';
      await db.prepare("INSERT INTO product_images (id, product_id, source_url, position, alt_text, created_at, updated_at) VALUES ('editorial-image', ?, ?, 42, 'Editorial', 'now', 'now')").bind(productId, editorialUrl).run();
      const imageRows = [{ ...row, 'Hình ảnh (url1,url2...)': `${newUrl},${editorialUrl}` }];
      await applyXlsxImport(db, imageRows, (await validateXlsxInput(imageRows)).digest, await snapshot(imageRows));
      const images = await db.prepare('SELECT id, source_url, position, alt_text FROM product_images WHERE product_id = ? ORDER BY id').bind(productId).all<{ id: string; source_url: string; position: number; alt_text: string | null }>();
      check(images.results.length === 3 && images.results.some(item => item.id === assignedImage.id) && images.results.some(item => item.id === 'editorial-image' && item.position === 42 && item.alt_text === 'Editorial'), 'replacement removed assigned image or changed editorial image');
      check(!!await db.prepare('SELECT 1 FROM product_variant_images WHERE variant_id = ? AND image_id = ? AND position = 1').bind(mappings.results[0].variant_id, assignedImage.id).first(), 'reimport removed variant image assignment');
      check(!await db.prepare('SELECT 1 FROM xlsx_product_images WHERE product_id = ? AND image_id = ?').bind(productId, assignedImage.id).first(), 'omitted image retained XLSX ownership');
      await db.prepare('UPDATE product_images SET position = CASE WHEN source_url = ? THEN 0 WHEN source_url = ? THEN 1 ELSE 2 END WHERE product_id = ?').bind(newUrl, editorialUrl, productId).run();
      const reversed = [{ ...row, 'Hình ảnh (url1,url2...)': `${editorialUrl},${newUrl}` }];
      await applyXlsxImport(db, reversed, (await validateXlsxInput(reversed)).digest, await snapshot(reversed));
      const reorderedImages = await db.prepare('SELECT source_url, position FROM product_images WHERE product_id = ? ORDER BY position').bind(productId).all<{ source_url: string; position: number }>();
      check(reorderedImages.results[0]?.source_url === newUrl && reorderedImages.results[1]?.source_url === editorialUrl, 'reimport changed manual image order');
      const ownership = await db.prepare('SELECT source_url, position, created_by_xlsx FROM xlsx_product_images WHERE product_id = ? ORDER BY position').bind(productId).all<{ source_url: string; position: number; created_by_xlsx: number }>();
      check(ownership.results.length === 2 && ownership.results[0].source_url === editorialUrl && ownership.results[0].created_by_xlsx === 0 && ownership.results[1].source_url === newUrl && ownership.results[1].created_by_xlsx === 1, 'image reorder or ownership incorrect');
      const extraUrl = 'https://cdn-images.kiotviet.vn/extra.jpg';
      const withExtra = [{ ...row, 'Hình ảnh (url1,url2...)': `${editorialUrl},${extraUrl},${newUrl}` }];
      await applyXlsxImport(db, withExtra, (await validateXlsxInput(withExtra)).digest, await snapshot(withExtra));
      const extraImage = await db.prepare('SELECT position FROM product_images WHERE product_id = ? AND source_url = ?').bind(productId, extraUrl).first<{ position: number }>();
      check(extraImage?.position === 3, 'new image not appended after existing images');
      const onlyNew = [{ ...row, 'Hình ảnh (url1,url2...)': newUrl }];
      await applyXlsxImport(db, onlyNew, (await validateXlsxInput(onlyNew)).digest, await snapshot(onlyNew));
      check(!!await db.prepare("SELECT id FROM product_images WHERE id = 'editorial-image' AND position = 1").first(), 'removed editorial image');
      const inactiveSubset = [{ ...row, 'Đang kinh doanh': false }];
      await applyXlsxImport(db, inactiveSubset, (await validateXlsxInput(inactiveSubset)).digest, await snapshot(inactiveSubset));
      const productStatus = await db.prepare('SELECT is_active FROM products WHERE id = ?').bind(productId).first<{ is_active: number }>();
      check(productStatus?.is_active === 1, 'partial inactive variant hid active product');
      const subset = [rows[0]];
      await applyXlsxImport(db, subset, (await validateXlsxInput(subset)).digest, await snapshot(subset));
      const active = await db.prepare('SELECT COUNT(*) AS count FROM product_variants WHERE is_active = 1').first<{ count: number }>();
      check(active?.count === 3, 'absent variant deactivated');
      for (const [input, hash] of [[subset, digest], [[{ ...row, 'Giá bán': -1 }], (await validateXlsxInput([{ ...row, 'Giá bán': -1 }])).digest]] as const) {
        let failed = false;
        try { await applyXlsxImport(db, input, hash, await snapshot(input)); } catch { failed = true; }
        check(failed, 'invalid or stale input accepted');
      }
      const conflict = [{ ...row, 'Mã hàng': 'DEMO-M', 'Thuộc tính': '' }];
      let failed = false;
      try { await applyXlsxImport(db, conflict, (await validateXlsxInput(conflict)).digest, await snapshot(conflict)); } catch { failed = true; }
      check(failed, 'reassignment accepted');
      const groupedToStandalone = [{ ...row, 'Mã hàng': 'DEMO', 'Thuộc tính': '' }];
      const standaloneToGrouped = [{ ...row, 'Mã hàng': 'OTHER-M', 'Thuộc tính': 'SIZE: M' }];
      const categoryChange = [{ ...row, 'Nhóm hàng(3 Cấp)': 'Different' }];
      await db.prepare("INSERT INTO categories (id, name, slug, created_at, updated_at) VALUES ('editorial', 'Editorial', 'editorial', 'now', 'now')").run();
      await db.prepare("INSERT INTO product_category (product_id, category_id) VALUES (?, 'editorial')").bind(productId).run();
      for (const input of [groupedToStandalone, standaloneToGrouped, categoryChange]) {
        let rejected = false;
        try { await applyXlsxImport(db, input, (await validateXlsxInput(input)).digest, await snapshot(input)); } catch { rejected = true; }
        check(rejected, 'ambiguous model or category change accepted');
      }
      const links = await db.prepare('SELECT category_id FROM product_category WHERE product_id = ?').bind(productId).all();
      check(links.results.length === 2 && links.results.some(link => link.category_id === 'editorial'), 'category relationships changed');
      const stale = await snapshot(subset);
      await db.prepare("UPDATE products SET name = 'Changed' WHERE id = ?").bind(productId).run();
      let staleRejected = false;
      try { await applyXlsxImport(db, subset, (await validateXlsxInput(subset)).digest, stale); } catch (error) { staleRejected = String(error).includes('stale'); }
      check(staleRejected, 'changed product accepted stale preview');
      const unaffected = await snapshot(subset);
      const other = [rows[2]];
      await applyXlsxImport(db, other, (await validateXlsxInput(other)).digest, await snapshot(other));
      check(unaffected === await snapshot(subset), 'unrelated import invalidated snapshot');
      const staleAfterImport = await snapshot(subset);
      await applyXlsxImport(db, subset, (await validateXlsxInput(subset)).digest, await snapshot(subset));
      staleRejected = false;
      try { await applyXlsxImport(db, subset, (await validateXlsxInput(subset)).digest, staleAfterImport); } catch (error) { staleRejected = String(error).includes('stale'); }
      check(staleRejected, 'intervening import accepted stale preview');
      await db.prepare("INSERT INTO products (id, slug, name, created_at, updated_at) VALUES ('legacy', 'legacy', 'Legacy', 'now', 'now')").run();
      await db.prepare("INSERT INTO external_product_mappings (id, provider, external_id, product_id, created_at, updated_at) VALUES ('legacy-map', 'xlsx:kiotviet', 'legacy', 'legacy', 'now', 'now')").run();
      const legacy = [{ ...row, 'Mã hàng': 'LEGACY-M' }];
      let legacyRejected = false;
      try { await applyXlsxImport(db, legacy, (await validateXlsxInput(legacy)).digest, await snapshot(legacy)); } catch { legacyRejected = true; }
      check(legacyRejected, 'mapping with unknown grouping accepted');
      const count = await db.prepare('SELECT COUNT(*) AS count FROM products').first<{ count: number }>();
      check(count?.count === 3, 'failed import mutated catalog');
      const externalProduct = [{ ...row, 'Mã hàng': 'EXTERNAL-M' }];
      const beforeExternal = await snapshot(externalProduct);
      await db.prepare("INSERT INTO products (id, sku, slug, name, created_at, updated_at) VALUES ('outside', ' external ', 'outside', 'Outside', 'now', 'now')").run();
      check(beforeExternal !== await snapshot(externalProduct), 'external product collision did not invalidate snapshot');
      const externalVariant = [{ ...row, 'Mã hàng': 'VARIANT-M' }];
      const beforeVariant = await snapshot(externalVariant);
      await db.prepare("INSERT INTO product_variants (id, product_id, sku, name) VALUES ('outside-variant', 'outside', ' VaRiAnT-m ', 'Outside variant')").run();
      check(beforeVariant !== await snapshot(externalVariant), 'external variant collision did not invalidate snapshot');
      for (const [input, staleSnapshot] of [[externalProduct, beforeExternal], [externalVariant, beforeVariant]] as const) {
        const preview = await previewXlsxImport(db, input);
        check(preview.errors.some(error => error.column === 'Mã hàng'), 'external SKU collision missing from preview');
        const hash = (await validateXlsxInput(input)).digest;
        for (const token of [staleSnapshot, preview.catalogSnapshot]) {
          let rejected = false;
          try { await applyXlsxImport(db, input, hash, token); } catch { rejected = true; }
          check(rejected, 'external SKU collision accepted');
        }
      }
      const after = await db.prepare('SELECT COUNT(*) AS count FROM products').first<{ count: number }>();
      const variantsAfter = await db.prepare('SELECT COUNT(*) AS count FROM product_variants').first<{ count: number }>();
      check(after?.count === 4 && variantsAfter?.count === 4, 'collision import mutated catalog');
      await testSyntheticWorkbook(db);
      await testSlugs(db);
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
