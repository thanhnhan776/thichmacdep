import test from 'node:test';
import assert from 'node:assert/strict';
import { validateXlsxInput } from '../apps/api/src/services/xlsx-input.ts';

const row = () => ({
  'Loại hàng': 'Hàng hóa', 'Mã hàng': 'DEMO', 'Tên hàng': 'Synthetic',
  'Nhóm hàng(3 Cấp)': 'Demo', 'Giá bán': '100', 'Đang kinh doanh': true,
  'Được bán trực tiếp': true, 'Hình ảnh (url1,url2...)': 'https://cdn2-retail-images.kiotviet.vn/demo.jpg',
  'Thuộc tính': '',
});

test('requires an own attributes field on every row while allowing blank standalone attributes', async () => {
  for (const value of ['', null]) {
    const result = await validateXlsxInput([{ ...row(), 'Thuộc tính': value }]);
    assert.deepEqual(result.preview.errors, []);
    assert.equal(result.preview.products[0].standalone, true);
  }
  const missing = row();
  delete missing['Thuộc tính'];
  await assert.rejects(validateXlsxInput([row(), missing]), /Missing required column: Thuộc tính/);
});

test('server uses its own exact image host allowlist and binds a digest to input', async () => {
  const rows = [row()];
  const first = await validateXlsxInput(rows);
  assert.deepEqual(first.preview.errors, []);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.equal((await validateXlsxInput(rows)).digest, first.digest);
  rows[0]['Tên hàng'] = 'Changed';
  assert.notEqual((await validateXlsxInput(rows)).digest, first.digest);
  for (const host of ['cdn2-retail-images.kiotviet.vn', 'cdn1-retail-images.kiotviet.vn', 'cdn-images.kiotviet.vn']) {
    rows[0]['Hình ảnh (url1,url2...)'] = `https://${host}/a`;
    assert.deepEqual((await validateXlsxInput(rows)).preview.errors, []);
  }
  for (const host of ['cdn2-retail-images.kiotviet.vn.evil.test', 'cdn.kiotviet.vn', 'arbitrary.example']) {
    rows[0]['Hình ảnh (url1,url2...)'] = `https://${host}/a`;
    assert.ok((await validateXlsxInput(rows)).preview.errors.length);
  }
});

test('rejects non-JSON cells, malformed rows, and excessive columns', async () => {
  for (const input of [null, [null], [[]], [{ a: {} }], [{ a: Infinity }], [Object.fromEntries(Array.from({ length: 129 }, (_, i) => [String(i), 'x']))]]) {
    await assert.rejects(validateXlsxInput(input), TypeError);
  }
});
