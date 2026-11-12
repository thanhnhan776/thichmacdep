import test from 'node:test';
import assert from 'node:assert/strict';
import { validateXlsxRows } from '../apps/api/src/services/xlsx-rows.ts';

const hosts = ['cdn2-retail-images.kiotviet.vn'];
const row = (changes = {}) => ({
  'Loại hàng': 'Hàng hóa', 'Mã hàng': 'DEMO-S', 'Tên hàng': 'Synthetic shirt',
  'Nhóm hàng(3 Cấp)': 'Clothes / New', 'Thương hiệu': 'Example', 'Giá bán': '889000.0000',
  'Đang kinh doanh': true, 'Được bán trực tiếp': false,
  'Hình ảnh (url1,url2...)': 'https://cdn2-retail-images.kiotviet.vn/a.jpg;https://cdn2-retail-images.kiotviet.vn/b.jpg',
  'Thuộc tính': 'SIZE: S', ...changes,
});
const validate = rows => validateXlsxRows(rows, hosts);

test('groups matching SIZE suffixes and preserves ordered URLs and exact price', () => {
  const result = validate([row(), row({ 'Mã hàng': 'DEMO-M', 'Thuộc tính': 'size: m' })]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.products[0].key, 'DEMO');
  assert.equal(result.products[0].variants[0].price, 889000);
  assert.equal(result.products[0].variants[0].row, 2);
  assert.equal(result.products[0].variants[0].category, 'Clothes / New');
  assert.equal(result.products[0].variants[0].active, true);
  assert.equal(result.products[0].variants[0].directSale, false);
  assert.deepEqual(result.products[0].variants[0].images, ['https://cdn2-retail-images.kiotviet.vn/a.jpg', 'https://cdn2-retail-images.kiotviet.vn/b.jpg']);
});

test('normalizes classification and reports services and unknowns', () => {
  const result = validate([row({ 'Loại hàng': ' HÀNG HÓA ' }), row({ 'Loại hàng': 'Dịch vụ' }), row({ 'Loại hàng': '' })]);
  assert.deepEqual(result.counts, { rows: 3, goods: 1, services: 1, unknown: 1, products: 1 });
  assert.deepEqual(result.skipped.map(issue => issue.row), [3, 4]);
});

test('standalone rows do not group based on related codes or similar SKUs', () => {
  const result = validate([row({ 'Mã hàng': 'DEMO', 'Thuộc tính': '', 'Mã hàng liên quan': 'DEMO-S' }), row({ 'Mã hàng': 'DEMO-S', 'Thuộc tính': '' })]);
  assert.equal(result.products.length, 2);
  assert.ok(result.products.every(product => product.standalone));
});

test('infers blank sizes and removes matching terminal name suffixes', () => {
  const result = validate(['M', 'S', 'L'].map(size => row({
    'Mã hàng': `QD2-${size}`, 'Tên hàng': `Synthetic dress -${size === 'L' ? '' : ' '}${size}`, 'Thuộc tính': '',
  })));
  assert.deepEqual(result.errors, []);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].key, 'QD2');
  assert.deepEqual(result.products[0].variants.map(item => [item.name, item.size]), [
    ['Synthetic dress', 'M'], ['Synthetic dress', 'S'], ['Synthetic dress', 'L'],
  ]);
});

test('groups mixed explicit and inferred recognized sizes in either order', () => {
  const rows = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL'].map((size, index) => row({
    'Mã hàng': `MIX-${size}`, 'Tên hàng': `Synthetic - ${size}`,
    'Thuộc tính': index % 2 ? `SIZE: ${size}` : '',
  }));
  for (const input of [rows, [...rows].reverse()]) {
    const result = validate(input);
    assert.deepEqual(result.errors, []);
    assert.equal(result.products.length, 1);
    assert.deepEqual(new Set(result.products[0].variants.map(item => item.size)), new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL']));
  }
});

test('rejects conflicting inferred families without splitting them', () => {
  const base = row({ 'Mã hàng': 'DEMO-S', 'Tên hàng': 'Synthetic - S', 'Thuộc tính': '' });
  const other = row({ 'Mã hàng': 'DEMO-M', 'Tên hàng': 'Synthetic - M', 'Thuộc tính': '' });
  for (const change of [
    { 'Tên hàng': 'Synthetic - L' }, { 'Thương hiệu': 'Other' }, { 'Nhóm hàng(3 Cấp)': 'Other' },
    { 'Giá bán': '1' }, { 'Đang kinh doanh': false }, { 'Được bán trực tiếp': true },
    { 'Thuộc tính': 'SIZE: L' },
  ]) for (const rows of [[base, { ...other, ...change }], [{ ...other, ...change }, base]]) {
    const result = validate(rows);
    assert.ok(result.errors.length);
    assert.deepEqual(result.products, []);
  }
  assert.ok(validate([base, other, base]).errors.length);
});

test('supports explicit user-defined sizes but does not infer them', () => {
  const custom = row({ 'Mã hàng': 'CUSTOM-TALL', 'Tên hàng': 'Synthetic - TALL', 'Thuộc tính': 'SIZE: TALL' });
  const grouped = validate([custom, row({ 'Mã hàng': 'CUSTOM-PETITE', 'Tên hàng': 'Synthetic - PETITE', 'Thuộc tính': 'SIZE: PETITE' })]);
  assert.deepEqual(grouped.errors, []);
  assert.equal(grouped.products[0].variants[0].name, 'Synthetic');
  const standalone = validate([{ ...custom, 'Thuộc tính': '' }]);
  assert.equal(standalone.products[0].standalone, true);
  assert.equal(standalone.products[0].variants[0].name, 'Synthetic - TALL');
});

test('rejects mismatched or ambiguous attributes and duplicate SKU', () => {
  for (const changed of [
    { 'Thuộc tính': 'SIZE: M' }, { 'Thuộc tính': 'SIZE: S; Color: red' },
    { 'Mã hàng': 'DEMOS' }, { 'Mã hàng': 123 },
  ]) assert.ok(validate([row(changed)]).errors.length);
  assert.ok(validate([row(), row({ 'Mã hàng': 'demo-s' })]).errors.length);
});

test('rejects group conflicts and standalone collision regardless of order', () => {
  const variant = row();
  const standalone = row({ 'Mã hàng': 'DEMO', 'Thuộc tính': '' });
  for (const rows of [[variant, standalone], [standalone, variant]]) assert.ok(validate(rows).errors.length);
  for (const change of [
    { 'Tên hàng': 'Other' }, { 'Thương hiệu': 'Other' }, { 'Nhóm hàng(3 Cấp)': 'Other' },
    { 'Giá bán': '1' }, { 'Đang kinh doanh': false }, { 'Được bán trực tiếp': true },
  ]) {
    const result = validate([variant, row({ 'Mã hàng': 'DEMO-M', 'Thuộc tính': 'SIZE: M', ...change })]);
    assert.ok(result.errors.length);
    assert.deepEqual(result.products, []);
  }
});

test('strict prices, required fields, flags and trusted image URLs', () => {
  for (const value of ['1.01', '-1', '1,000', '1e3', '9007199254740992', 1.5]) assert.ok(validate([row({ 'Giá bán': value })]).errors.length);
  for (const change of [
    { 'Tên hàng': '' }, { 'Nhóm hàng(3 Cấp)': '' }, { 'Đang kinh doanh': 'unknown' },
    { 'Được bán trực tiếp': 'unknown' },
    { 'Hình ảnh (url1,url2...)': 'http://cdn2-retail-images.kiotviet.vn/a' }, { 'Hình ảnh (url1,url2...)': 'https://evil.test/a' },
    { 'Hình ảnh (url1,url2...)': 'https://user@cdn2-retail-images.kiotviet.vn/a' }, { 'Hình ảnh (url1,url2...)': 'https://cdn2-retail-images.kiotviet.vn:444/a' },
  ]) assert.ok(validate([row(change)]).errors.length);
});

test('server rejects missing canonical fields even when short aliases are supplied', () => {
  const input = row();
  for (const key of ['Nhóm hàng(3 Cấp)', 'Đang kinh doanh', 'Được bán trực tiếp', 'Hình ảnh (url1,url2...)']) delete input[key];
  Object.assign(input, { 'Nhóm hàng': 'Demo', 'Trạng thái': true, 'Bán trực tiếp': true, 'Hình ảnh': 'https://cdn2-retail-images.kiotviet.vn/a' });
  assert.deepEqual(validate([input]).errors.map(issue => issue.column), [
    'Nhóm hàng(3 Cấp)', 'Đang kinh doanh', 'Được bán trực tiếp', 'Hình ảnh (url1,url2...)',
  ]);
});

test('bounds rows and cell lengths', () => {
  assert.ok(validate(Array.from({ length: 10001 }, () => row())).errors.length);
  assert.ok(validate([row({ 'Tên hàng': 'x'.repeat(8193) })]).errors.length);
});
