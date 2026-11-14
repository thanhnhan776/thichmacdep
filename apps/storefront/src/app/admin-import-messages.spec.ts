import { describe, expect, it } from 'vitest';
import { translateImportColumn, translateImportReason } from './admin-import-messages';

describe('Vietnamese import messages', () => {
  it('translates parser and server errors, including dynamic row numbers', () => {
    expect(translateImportReason('Workbook must contain exactly one sheet')).toContain('đúng một trang tính');
    expect(translateImportReason('Service excluded')).toContain('dịch vụ');
    expect(translateImportReason('Duplicate SKU (also row 42)')).toBe('SKU bị trùng (cùng với dòng 42).');
    expect(translateImportReason('Conflicting group fields (also row 7)')).toContain('dòng 7');
  });

  it('does not expose unknown errors or column names', () => {
    expect(translateImportReason('secret internal error')).not.toContain('secret');
    expect(translateImportReason('Duplicate SKU (also row 2) injected')).not.toContain('injected');
    expect(translateImportColumn('internal column')).toBe('Dữ liệu');
    expect(translateImportColumn('Mã hàng')).toBe('Mã hàng');
  });
});
