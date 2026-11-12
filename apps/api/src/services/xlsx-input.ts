import { validateXlsxRows, type ImportPreview, type ImportRow } from './xlsx-rows.ts';
import { IMAGE_HOSTS } from './image-url.ts';

const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10000;
const MAX_COLUMNS = 128;
const MAX_CELL_LENGTH = 8192;

export interface ValidatedXlsxInput {
  digest: string;
  preview: ImportPreview;
}

/** Validate decoded JSON at the server boundary; never trusts client-side validation.
 * Callers must additionally enforce a streaming body limit before parsing JSON.
 * This cannot prove that the original workbook contained no formulas: the parser's
 * workbook-structure checks remain a separate, necessary trust boundary. */
export async function validateXlsxInput(input: unknown): Promise<ValidatedXlsxInput> {
  if (!Array.isArray(input) || input.length > MAX_ROWS) throw new TypeError('Invalid row array');
  let cells = 0;
  for (const row of input) {
    if (row === null || typeof row !== 'object' || Array.isArray(row) || Object.getPrototypeOf(row) !== Object.prototype) {
      throw new TypeError('Invalid row');
    }
    if (!Object.prototype.hasOwnProperty.call(row, 'Thuộc tính')) throw new TypeError('Missing required column: Thuộc tính');
    const entries = Object.entries(row);
    cells += entries.length;
    if (entries.length > MAX_COLUMNS || cells > 200000) throw new TypeError('Too many cells');
    for (const [key, value] of entries) {
      if (key.length > MAX_CELL_LENGTH || (typeof value === 'string' && value.length > MAX_CELL_LENGTH) ||
          !(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) {
        throw new TypeError('Invalid cell');
      }
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  if (bytes.byteLength > MAX_JSON_BYTES) throw new TypeError('Input exceeds size limit');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return { digest, preview: validateXlsxRows(input as ImportRow[], IMAGE_HOSTS) };
}
