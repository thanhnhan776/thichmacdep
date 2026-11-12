import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateSlug, normalizeSlug } from '../apps/api/src/services/slugs.ts';

test('normalizes Vietnamese accents, including both forms of đ', () => {
  assert.equal(normalizeSlug('Đầm ĐỎ và áo dài'), 'dam-do-va-ao-dai');
});

test('normalizes punctuation and falls back for names without ASCII', () => {
  assert.equal(normalizeSlug('  Áo / Quần---2026! '), 'ao-quan-2026');
  assert.equal(normalizeSlug(''), 'item');
  assert.equal(normalizeSlug('!!! 中文'), 'item');
});

test('truncates without leaving a trailing hyphen', () => {
  assert.equal(normalizeSlug('Áo dài đẹp', 7), 'ao-dai');
  assert.equal(normalizeSlug('', 2), 'it');
});

test('allocates deterministic numeric suffixes case-insensitively without mutating used slugs', () => {
  const used = new Set(['AO-DAI', 'ao-dai-2', 'ao-dai-4']);
  assert.equal(allocateSlug('Áo dài', used), 'ao-dai-3');
  assert.deepEqual([...used], ['AO-DAI', 'ao-dai-2', 'ao-dai-4']);
});

test('repeated accented names collide and suffixes respect length limits', () => {
  const used = new Set();
  for (const expected of ['dam-do', 'dam-do-2', 'dam-do-3']) {
    const slug = allocateSlug('Đầm đỏ', used, 8);
    assert.equal(slug, expected);
    used.add(slug);
  }
  assert.equal(allocateSlug('Áo dài đẹp', new Set(['ao-dai-d', 'ao-dai-2']), 8), 'ao-dai-3');
});

test('rejects invalid or exhausted length limits', () => {
  assert.throws(() => normalizeSlug('name', 0), RangeError);
  assert.throws(() => normalizeSlug('name', 1.5), RangeError);
  assert.throws(() => allocateSlug('a', new Set(['a']), 2), RangeError);
});
