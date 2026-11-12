/** Pure validation of already-decoded cells. The caller must reject formulas,
 * duplicate/missing headers and unsupported workbook structures before calling. */
export type Cell = string | number | boolean | null;
export type ImportRow = Record<string, Cell>;
export interface ImportIssue { row: number | null; column: string; reason: string }
export interface ImportItem {
  row: number; sku: string; name: string; category: string; brand: string;
  price: number; active: boolean; directSale: boolean; images: string[];
  size: string | null;
}
export interface ImportProduct { key: string; variants: ImportItem[]; standalone: boolean }
export interface ImportPreview {
  products: ImportProduct[]; errors: ImportIssue[]; skipped: ImportIssue[];
  counts: { rows: number; goods: number; services: number; unknown: number; products: number };
}

const MAX_ROWS = 10000;
const MAX_CELLS = 200000;
const MAX_CELL_LENGTH = 8192;
const normalize = (value: string) => value.normalize('NFC').trim();
export const normalizeXlsxKey = (value: string) => normalize(value).toLocaleLowerCase('vi');
const fold = normalizeXlsxKey;
const text = (value: Cell | undefined) => typeof value === 'string' ? normalize(value) : '';

function price(value: Cell | undefined): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d+)(?:\.(0+))?$/.exec(value.trim());
  if (!match) return null;
  const integer = Number(match[1]);
  return Number.isSafeInteger(integer) ? integer : null;
}

function flag(value: Cell | undefined): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value !== 'string') return null;
  const normalized = fold(value);
  if (['true', '1', 'có', 'đang kinh doanh'].includes(normalized)) return true;
  if (['false', '0', 'không', 'ngừng kinh doanh'].includes(normalized)) return false;
  return null;
}

function images(value: Cell | undefined, hosts: readonly string[]): string[] | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const urls = value.split(/[\n,;]/).map(normalize);
  if (urls.some(url => !url)) return null;
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !hosts.some(host => host.toLowerCase() === url.hostname)) return null;
    } catch { return null; }
  }
  return urls;
}

/** Attributes are either empty or a single `SIZE: value` / `SIZE=value` pair.
 * Other dimensions are intentionally rejected, not silently discarded. */
function size(value: Cell | undefined): string | null | false {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return false;
  if (!value.trim()) return null;
  const match = /^\s*([^:=;,\n]+)\s*[:=]\s*([^:=;,\n]+)\s*$/u.exec(value);
  if (!match || fold(match[1]) !== 'size' || !normalize(match[2])) return false;
  return normalize(match[2]);
}

function groupName(name: string, variantSize: string): string {
  const match = /^(.*?)\s+-\s*([^\s]+)\s*$/u.exec(name);
  return match && normalize(match[1]) && fold(match[2]) === fold(variantSize) ? normalize(match[1]) : name;
}

/** Rows start at spreadsheet row 2. Hostnames are exact allowlist entries supplied
 * by trusted configuration; this function never requests or resolves URLs. */
export function validateXlsxRows(rows: readonly ImportRow[], trustedImageHosts: readonly string[]): ImportPreview {
  const errors: ImportIssue[] = [];
  const skipped: ImportIssue[] = [];
  const counts = { rows: rows.length, goods: 0, services: 0, unknown: 0, products: 0 };
  const fail = (row: number | null, column: string, reason: string) => errors.push({ row, column, reason });
  if (rows.length > MAX_ROWS || rows.reduce((n, row) => n + Object.keys(row).length, 0) > MAX_CELLS) {
    fail(null, '', 'Workbook exceeds row or cell limit');
    return { products: [], errors, skipped, counts };
  }
  const groups = new Map<string, ImportProduct>();
  const codes = new Map<string, number>();
  // Infer SIZE only for a recognizable SKU family with multiple distinct members.
  // A lone SKU ending in one of these letters remains a standalone product.
  const inferredSizes = new Map<number, string>();
  const suffixFamilies = new Map<string, { index: number; suffix: string }[]>();
  rows.forEach((row, index) => {
    if (fold(text(row['Loại hàng'])) !== fold('Hàng hóa')) return;
    const sku = text(row['Mã hàng']);
    const match = /^(.*)-(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-9]XL)$/i.exec(sku);
    if (!match || !normalize(match[1])) return;
    const key = fold(match[1]);
    const family = suffixFamilies.get(key) ?? [];
    family.push({ index, suffix: match[2].toUpperCase() });
    suffixFamilies.set(key, family);
  });
  for (const family of suffixFamilies.values()) if (new Set(family.map(member => member.suffix)).size > 1) {
    for (const member of family) inferredSizes.set(member.index, member.suffix);
  }
  rows.forEach((row, index) => {
    const number = index + 2;
    if (Object.values(row).some(value => typeof value === 'string' && value.length > MAX_CELL_LENGTH)) {
      fail(number, '', 'Cell exceeds length limit'); return;
    }
    const classification = fold(text(row['Loại hàng']));
    if (classification !== fold('Hàng hóa')) {
      if (classification === fold('Dịch vụ')) counts.services++; else counts.unknown++;
      skipped.push({ row: number, column: 'Loại hàng', reason: classification === fold('Dịch vụ') ? 'Service excluded' : 'Missing or unrecognized classification' });
      return;
    }
    counts.goods++;
    const start = errors.length;
    const sku = text(row['Mã hàng']);
    const name = text(row['Tên hàng']);
    const category = text(row['Nhóm hàng(3 Cấp)']);
    const brand = text(row['Thương hiệu']);
    const amount = price(row['Giá bán']);
    const active = flag(row['Đang kinh doanh']);
    const directSale = flag(row['Được bán trực tiếp']);
    const imageUrls = images(row['Hình ảnh (url1,url2...)'], trustedImageHosts);
    const explicitSize = size(row['Thuộc tính']);
    const variantSize = explicitSize === null ? inferredSizes.get(index) ?? null : explicitSize;
    if (!sku) fail(number, 'Mã hàng', 'SKU must be nonempty text');
    if (sku) {
      const key = fold(sku);
      if (codes.has(key)) fail(number, 'Mã hàng', `Duplicate SKU (also row ${codes.get(key)})`);
      else codes.set(key, number);
    }
    if (!name) fail(number, 'Tên hàng', 'Name must be nonempty text');
    if (!category) fail(number, 'Nhóm hàng(3 Cấp)', 'Category must be nonempty text');
    if (amount === null) fail(number, 'Giá bán', 'Expected a nonnegative safe integer VND amount');
    if (active === null) fail(number, 'Đang kinh doanh', 'Unrecognized status');
    if (directSale === null) fail(number, 'Được bán trực tiếp', 'Unrecognized direct-sale flag');
    if (!imageUrls) fail(number, 'Hình ảnh (url1,url2...)', 'Expected ordered HTTPS URLs on trusted hosts');
    if (variantSize === false) fail(number, 'Thuộc tính', 'Expected one SIZE dimension');
    let key = sku;
    if (typeof variantSize === 'string') {
      const separator = sku.lastIndexOf('-');
      if (separator <= 0 || fold(sku.slice(separator + 1)) !== fold(variantSize) || !normalize(sku.slice(0, separator))) {
        fail(number, 'Mã hàng', 'SIZE requires a matching complete hyphen-separated SKU suffix');
      } else key = normalize(sku.slice(0, separator));
    }
    if (errors.length !== start || amount === null || active === null || directSale === null || !imageUrls || variantSize === false) return;
    const normalizedName = variantSize === null ? name : groupName(name, variantSize);
    const item: ImportItem = { row: number, sku, name: normalizedName, category, brand, price: amount, active, directSale, images: imageUrls, size: variantSize };
    const groupKey = fold(key);
    const existing = groups.get(groupKey);
    if (!existing) { groups.set(groupKey, { key, variants: [item], standalone: variantSize === null }); return; }
    const first = existing.variants[0];
    if (existing.standalone || variantSize === null) fail(number, 'Mã hàng', `Standalone/group key collision (also row ${first.row})`);
    if (existing.variants.some(variant => variant.size !== null && variantSize !== null && fold(variant.size) === fold(variantSize))) fail(number, 'Thuộc tính', 'Duplicate SIZE in group');
    if (first.name !== normalizedName || first.brand !== brand || first.category !== category || first.price !== amount || first.active !== active || first.directSale !== directSale) {
      fail(number, '', `Conflicting group fields (also row ${first.row})`);
    }
    existing.variants.push(item);
  });
  // Validation errors block the entire preview's proposed products, including all
  // members of a group with an invalid row; applying partial groups is unsafe.
  const products = errors.length ? [] : [...groups.values()];
  counts.products = products.length;
  return { products, errors, skipped, counts };
}
