import * as XLSX from 'xlsx';
import { parseXlsx } from './xlsx-parser';

const headers = ['Loại hàng', 'Mã hàng', 'Tên hàng', 'Nhóm hàng(3 Cấp)', 'Giá bán', 'Đang kinh doanh', 'Được bán trực tiếp', 'Hình ảnh (url1,url2...)', 'Thuộc tính'];

function workbook(): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    headers,
    ['Hàng hóa', '001', 'Synthetic', 'Demo', '100.00', true, true, 'https://example.invalid/a'],
  ]), 'Products');
  return book;
}

function blob(book: XLSX.WorkBook): Blob {
  const data: ArrayBuffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  return new Blob([data]);
}

describe('parseXlsx', () => {
  it('preserves text and spreadsheet row numbers', async () => {
    const result = await parseXlsx(blob(workbook()));
    expect(result.headers).toEqual(headers);
    expect(result.rows[0].row).toBe(2);
    expect(result.rows[0].values['Mã hàng']).toBe('001');
    expect(result.rows[0].values['Giá bán']).toBe('100.00');
    expect(result.rows[0].values['Nhóm hàng(3 Cấp)']).toBe('Demo');
    expect(result.rows[0].values['Đang kinh doanh']).toBe(true);
    expect(result.rows[0].values['Được bán trực tiếp']).toBe(true);
    expect(result.rows[0].values['Hình ảnh (url1,url2...)']).toBe('https://example.invalid/a');
    expect(result.rows[0].values['Thuộc tính']).toBeNull();
  });

  it('rejects a workbook missing the attributes column', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      headers.slice(0, -1),
      ['Hàng hóa', '001', 'Synthetic', 'Demo', '100.00', true, true, 'https://example.invalid/a'],
    ]), 'Products');
    await expect(parseXlsx(blob(book))).rejects.toThrow('Missing required column');
  });

  it('rejects corrupt files', async () => {
    await expect(parseXlsx(new Blob(['not a workbook']))).rejects.toThrow();
    await expect(parseXlsx(new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 0])]))).rejects.toThrow();
  });

  it('accepts the numeric display format used by exported workbooks', async () => {
    const book = workbook();
    book.Sheets['Products']['E2'] = { t: 'n', v: 100, z: '#,0' };
    const result = await parseXlsx(blob(book));
    expect(result.rows[0].values['Giá bán']).toBe(100);
  });

  it('rejects multiple sheets', async () => {
    const book = workbook();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['extra']]), 'Extra');
    await expect(parseXlsx(blob(book))).rejects.toThrow('exactly one sheet');
  });

  it('rejects formula cells even with a cached value', async () => {
    const book = workbook();
    book.Sheets['Products']['E2'] = { t: 'n', v: 100, f: '50+50' };
    await expect(parseXlsx(blob(book))).rejects.toThrow('Formula');
  });

  it('rejects duplicate headers and oversized files', async () => {
    const book = workbook();
    book.Sheets['Products']['B1'] = { t: 's', v: headers[0] };
    await expect(parseXlsx(blob(book))).rejects.toThrow('Duplicate');
    await expect(parseXlsx(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]))).rejects.toThrow('size');
  });
});
