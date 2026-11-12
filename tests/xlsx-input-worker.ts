import { validateXlsxInput } from '../apps/api/src/services/xlsx-input.ts';
import { previewXlsxImport } from '../apps/api/src/services/xlsx-preview.ts';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export default {
  async fetch(_request: Request, { DB: db }: { DB: D1Database }): Promise<Response> {
    try {
      const row = {
        'Loại hàng': 'Hàng hóa', 'Mã hàng': 'DEMO-M', 'Tên hàng': 'Example',
        'Nhóm hàng(3 Cấp)': 'Example category', 'Thương hiệu': 'Example brand',
        'Giá bán': '100', 'Đang kinh doanh': true, 'Được bán trực tiếp': true,
        'Hình ảnh (url1,url2...)': 'https://cdn1-retail-images.kiotviet.vn/example.jpg', 'Thuộc tính': 'SIZE: M',
      };
      const input = [row, { ...row, 'Mã hàng': 'DEMO-L', 'Thuộc tính': 'SIZE: L' }];
      const first = await validateXlsxInput(input);
      const repeat = await validateXlsxInput(input);
      check(first.digest === repeat.digest, 'digest changed on repeat');
      check(first.preview.errors.length === 0 && first.preview.products.length === 1, 'group validation failed');
      check(first.preview.products[0].variants.length === 2 && !first.preview.products[0].standalone, 'variants not grouped');
      const invalid = await validateXlsxInput([row, { ...row, 'Mã hàng': 'DEMO-L', 'Thuộc tính': 'SIZE: M' }]);
      check(invalid.digest !== first.digest && invalid.preview.errors.length > 0 && invalid.preview.products.length === 0, 'invalid group was not rejected');
      await db.prepare("INSERT INTO products (id, slug, name, created_at, updated_at) VALUES ('preview-product', 'preview-product', 'Synthetic', 'now', 'now')").run();
      await db.prepare("INSERT INTO external_product_mappings (id, provider, external_id, product_id, created_at, updated_at) VALUES ('preview-mapping', 'xlsx:kiotviet', 'demo', 'preview-product', 'now', 'now'), ('other-mapping', 'other', 'new0', 'preview-product', 'now', 'now')").run();
      const before = await db.prepare('SELECT COUNT(*) AS count FROM external_product_mappings').first<{ count: number }>();
      const many = Array.from({ length: 101 }, (_, i) => ({ ...row, 'Mã hàng': `NEW${i}`, 'Thuộc tính': '' }));
      const result = await previewXlsxImport(db, [...input, ...many]);
      check(result.digest === (await validateXlsxInput([...input, ...many])).digest, 'preview digest mismatch');
      check(result.counts.updates === 1 && result.counts.creates === 101, 'preview identity counts incorrect');
      check(result.counts.images === 103, 'preview image entries must include repeated URLs across variants');
      check(!JSON.stringify(result).includes('example.jpg'), 'preview exposed input');
      const failed = await previewXlsxImport(db, [row, { ...row, 'Mã hàng': 'DEMO-L', 'Thuộc tính': 'SIZE: M' }]);
      check(failed.errors.length > 0 && failed.counts.creates === 0 && failed.counts.updates === 0, 'errors did not block proposals');
      const after = await db.prepare('SELECT COUNT(*) AS count FROM external_product_mappings').first<{ count: number }>();
      check(before?.count === after?.count, 'preview changed mappings');
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
