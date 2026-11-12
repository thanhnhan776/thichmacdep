const DEFAULT_MAX_LENGTH = 100;

/** Fold Vietnamese diacritics/case and normalize separators for text matching. */
export function normalizeSearchTerm(value: string): string {
  return value.replace(/[đĐ]/g, 'd').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function validateMaxLength(maxLength: number): void {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) throw new RangeError('Slug max length must be a positive integer');
}

/** Normalize a name to a lowercase ASCII slug, bounded by maxLength. */
export function normalizeSlug(name: string, maxLength = DEFAULT_MAX_LENGTH): string {
  validateMaxLength(maxLength);
  const slug = normalizeSearchTerm(name);
  return (slug || 'item').slice(0, maxLength).replace(/-+$/, '');
}

/** Allocate the first available slug without modifying the supplied set. */
export function allocateSlug(name: string, used: ReadonlySet<string>, maxLength = DEFAULT_MAX_LENGTH): string {
  const base = normalizeSlug(name, maxLength);
  const occupied = new Set(Array.from(used, slug => slug.toLowerCase()));
  if (!occupied.has(base)) return base;
  for (let number = 2; Number.isSafeInteger(number); number++) {
    const suffix = `-${number}`;
    if (suffix.length >= maxLength) throw new RangeError('Slug max length exhausted');
    const prefix = base.slice(0, maxLength - suffix.length).replace(/-+$/, '');
    const candidate = `${prefix}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new RangeError('Slug suffixes exhausted');
}
