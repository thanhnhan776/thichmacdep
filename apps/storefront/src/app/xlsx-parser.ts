import type { CellObject, WorkSheet } from 'xlsx';

export type XlsxCell = string | number | boolean | null;
export type XlsxRowValues = Record<string, XlsxCell>;
export interface XlsxRow { row: number; values: XlsxRowValues }
export interface XlsxRows { headers: string[]; rows: XlsxRow[] }

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10000;
const MAX_COLUMNS = 100;
const MAX_CELLS = 200000;
const MAX_CHARS = 8192;
const REQUIRED = ['Loại hàng', 'Mã hàng', 'Tên hàng', 'Nhóm hàng(3 Cấp)', 'Giá bán', 'Đang kinh doanh', 'Được bán trực tiếp', 'Hình ảnh (url1,url2...)', 'Thuộc tính'];

function value(cell: CellObject | undefined): XlsxCell {
  if (!cell) return null;
  if (cell.f != null || cell.F != null) throw new Error('Formula cells are not supported');
  if (cell.t === 'z') return null;
  if (cell.t === 's' && typeof cell.v === 'string' && cell.v.length <= MAX_CHARS) return cell.v;
  if (cell.t === 'b' && typeof cell.v === 'boolean') return cell.v;
  if (cell.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v)) return cell.v;
  throw new Error('Unsupported cell type or cell exceeds length limit');
}

/** Parses only in a browser. Results are untrusted; the server must revalidate them. */
export async function parseXlsx(file: Blob): Promise<XlsxRows> {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('XLSX parsing requires a browser');
  if (file.size === 0 || file.size > MAX_BYTES) throw new Error('Workbook exceeds file size limit or is empty');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error('Expected an unencrypted XLSX archive');
  }
  const xlsx = await import('xlsx');
  let workbook: ReturnType<typeof xlsx.read>;
  try {
    workbook = xlsx.read(bytes, { type: 'array', cellFormula: true, sheetStubs: true, bookVBA: true, bookFiles: true, nodim: true });
  } catch {
    throw new Error('Unreadable or encrypted workbook');
  }
  const archive = workbook as typeof workbook & { keys?: string[]; vbaraw?: unknown };
  if (!archive.keys?.some(key => key === '[Content_Types].xml') || archive.vbaraw ||
      archive.keys.some(key => /(^|\/)(vbaProject\.bin|externalLinks|macrosheets|dialogSheets)(\/|$)/i.test(key))) {
    throw new Error('Unsupported workbook structure');
  }
  if (workbook.SheetNames.length !== 1) throw new Error('Workbook must contain exactly one sheet');
  const sheet: WorkSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet || !sheet['!ref'] || sheet['!merges']?.length || sheet['!type']) throw new Error('Unsupported or empty worksheet');
  const range = xlsx.utils.decode_range(sheet['!ref']);
  if (range.s.r !== 0 || range.s.c !== 0 || range.e.r > MAX_ROWS || range.e.c >= MAX_COLUMNS ||
      (range.e.r + 1) * (range.e.c + 1) > MAX_CELLS) throw new Error('Worksheet exceeds limits or has no header row');
  const headers: string[] = [];
  const seen = new Set<string>();
  for (let c = 0; c <= range.e.c; c++) {
    const header = value(sheet[xlsx.utils.encode_cell({ r: 0, c })]);
    if (typeof header !== 'string' || !header.trim()) throw new Error('Missing column header');
    const normalized = header.normalize('NFC').trim();
    const key = normalized.toLocaleLowerCase('vi');
    if (seen.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Duplicate or unsupported column header');
    seen.add(key);
    headers.push(normalized);
  }
  if (REQUIRED.some(header => !headers.includes(header))) throw new Error('Missing required column');
  const rows: XlsxRow[] = [];
  for (let r = 1; r <= range.e.r; r++) {
    const values: Record<string, XlsxCell> = {};
    headers.forEach((header, c) => { values[header] = value(sheet[xlsx.utils.encode_cell({ r, c })]); });
    rows.push({ row: r + 1, values });
  }
  return { headers, rows };
}
