// One-shot local SQLite migration. Never imported by the API or exposed as a Worker.
import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allocateSlug } from '../apps/api/src/services/slugs.ts';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const generated = {
  products: new RegExp(`^product-${uuid}$`, 'i'),
  categories: new RegExp(`^(?:category-${uuid}|xlsx-category-[0-9a-f]{64})$`, 'i'),
};

/** Run only against a local SQLite database; callers must opt in explicitly. */
export function migrateLocalSlugs(databasePath, local) {
  if (local !== true || typeof databasePath !== 'string' || !databasePath.trim() || databasePath === ':memory:' || databasePath.startsWith('file:')) {
    throw new Error('Explicit --local and a local database file path are required');
  }
  if (!statSync(resolve(databasePath)).isFile()) throw new Error('Database must be an existing local file');
  const db = new DatabaseSync(resolve(databasePath), { open: true, readOnly: false });
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const counts = {};
      for (const table of ['products', 'categories']) {
        const rows = db.prepare(`SELECT id, name, slug FROM ${table} ORDER BY id COLLATE BINARY`).all();
        // Reserving generated slugs too avoids transient UNIQUE conflicts, including
        // when a new readable slug happens to equal another row's old slug.
        const used = new Set(rows.map(row => row.slug.toLowerCase()));
        const update = db.prepare(`UPDATE ${table} SET slug = ? WHERE id = ? AND slug = ?`);
        let count = 0;
        for (const row of rows) {
          if (!generated[table].test(row.slug)) continue;
          let slug = allocateSlug(row.name, used);
          // A readable name may itself resemble a legacy generated slug. Avoid
          // producing one so that a repeat migration never rewrites it.
          while (generated[table].test(slug)) {
            used.add(slug);
            slug = allocateSlug(row.name, used);
          }
          used.add(slug);
          if (update.run(slug, row.id, row.slug).changes !== 1) throw new Error(`Concurrent change in ${table}`);
          count++;
        }
        counts[table] = count;
      }
      db.exec('COMMIT');
      return counts;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--local' || !args[1]) {
    console.error('Usage: node scripts/migrate-local-slugs.mjs --local /path/to/local-d1.sqlite');
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(migrateLocalSlugs(args[1], true)));
    } catch (error) {
      console.error(String(error));
      process.exitCode = 1;
    }
  }
}
