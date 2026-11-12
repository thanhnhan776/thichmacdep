function rank(value: string): number {
  const size = value.trim().toUpperCase();
  if (/^X+S$/.test(size)) return -size.length;
  if (size === 'S') return -1;
  if (size === 'M') return 0;
  if (size === 'L') return 1;
  if (/^X+L$/.test(size)) return size.length;
  const numeric = /^(\d+)XL$/.exec(size);
  if (numeric && Number.isSafeInteger(Number(numeric[1])) && Number(numeric[1]) >= 1) return Number(numeric[1]) + 1;
  return Infinity;
}
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function compareGarmentSizes(a: string, b: string): number {
  const ar = rank(a), br = rank(b);
  return (ar === br ? 0 : ar < br ? -1 : 1)
    || compareText(a.trim().toUpperCase(), b.trim().toUpperCase())
    || compareText(a, b);
}

/** Sort recognized garment sizes first, followed by unknown values in code-point order. */
export function sortGarmentSizes(sizes: readonly string[]): string[] {
  return [...sizes].sort(compareGarmentSizes);
}
