import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Temporary proof table; the normalized catalog is a later phase.
export const localSmokeChecks = sqliteTable('local_smoke_checks', {
  id: text('id').primaryKey(),
  value: text('value').notNull(),
});
