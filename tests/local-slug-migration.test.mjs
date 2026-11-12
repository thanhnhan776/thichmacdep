import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { migrateLocalSlugs } from '../scripts/migrate-local-slugs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('local D1 slug migration is atomic, stable, and preserves unrelated data', { timeout: 120000 }, () => {
  const persist = mkdtempSync(join(tmpdir(), 'slug-migration-test-'));
  try {
    execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], {
      cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'pipe',
    });
    const databases = files(persist).filter(path => {
      if (!path.endsWith('.sqlite')) return false;
      const candidate = new DatabaseSync(path, { readOnly: true });
      try {
        return Boolean(candidate.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'products'").get());
      } finally {
        candidate.close();
      }
    });
    assert.equal(databases.length, 1);
    const path = databases[0];
    const db = new DatabaseSync(path);
    const insertProduct = db.prepare('INSERT INTO products (id, slug, name, sku, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insertCategory = db.prepare('INSERT INTO categories (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    insertProduct.run('a', `product-${uuid(1)}`, 'Áo dài', 'sku', 'created', 'updated');
    insertProduct.run('b', `product-${uuid(2)}`, 'Áo dài', null, 'created', 'updated');
    insertProduct.run('c', `product-${uuid(3)}`, '', null, 'created', 'updated');
    insertProduct.run('d', `product-${uuid(4)}`, `product ${uuid(5)}`, null, 'created', 'updated');
    insertProduct.run('e', `product-${uuid(5)}`, 'Other', null, 'created', 'updated');
    insertProduct.run('custom', 'ao-dai', 'Custom', null, 'created', 'updated');
    insertProduct.run('almost', 'product-not-a-uuid', 'Custom', null, 'created', 'updated');
    insertCategory.run('a', `xlsx-category-${'a'.repeat(64)}`, 'Áo dài', 'created', 'updated');
    insertCategory.run('b', `category-${uuid(6)}`, 'Áo dài', 'created', 'updated');
    insertCategory.run('custom', 'ao-dai-2', 'Custom', 'created', 'updated');
    db.exec("INSERT INTO product_category VALUES ('a', 'a'); INSERT INTO website_product_settings (product_id, seo_title, created_at, updated_at) VALUES ('a', 'keep', 'created', 'updated')");
    const snapshot = () => JSON.stringify({
      products: db.prepare('SELECT * FROM products ORDER BY id').all(),
      categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
      links: db.prepare('SELECT * FROM product_category').all(),
      settings: db.prepare('SELECT * FROM website_product_settings').all(),
    });
    const before = snapshot();
    assert.throws(() => migrateLocalSlugs(path, false));
    db.exec("CREATE TRIGGER synthetic_conflict BEFORE UPDATE OF slug ON categories BEGIN SELECT RAISE(ABORT, 'synthetic conflict'); END");
    assert.throws(() => migrateLocalSlugs(path, true), /synthetic conflict/);
    assert.equal(snapshot(), before, 'failure must roll back product and category changes');
    db.exec('DROP TRIGGER synthetic_conflict');
    assert.deepEqual(migrateLocalSlugs(path, true), { products: 5, categories: 2 });
    assert.deepEqual(db.prepare('SELECT id, slug FROM products ORDER BY id').all().map(row => [row.id, row.slug]), [
      ['a', 'ao-dai-2'], ['almost', 'product-not-a-uuid'], ['b', 'ao-dai-3'], ['c', 'item'],
      ['custom', 'ao-dai'], ['d', `product-${uuid(5)}-2`], ['e', 'other'],
    ]);
    assert.deepEqual(db.prepare('SELECT id, slug FROM categories ORDER BY id').all().map(row => [row.id, row.slug]), [
      ['a', 'ao-dai'], ['b', 'ao-dai-3'], ['custom', 'ao-dai-2'],
    ]);
    const after = snapshot();
    const clean = value => {
      const data = JSON.parse(value);
      for (const row of [...data.products, ...data.categories]) delete row.slug;
      return data;
    };
    assert.deepEqual(clean(after), clean(before));
    assert.deepEqual(migrateLocalSlugs(path, true), { products: 0, categories: 0 });
    assert.equal(snapshot(), after);
    db.close();
  } finally {
    rmSync(persist, { recursive: true, force: true });
  }
});
