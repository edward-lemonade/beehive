import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/index.js';

const migrationsPath = fileURLToPath(new URL('../migrations/', import.meta.url));

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const migrationNames = (await readdir(migrationsPath))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name))
    .sort();

  for (const name of migrationNames) {
    const [applied] = await sql<{ name: string }[]>`
      SELECT name FROM schema_migrations WHERE name = ${name}
    `;
    if (applied) continue;

    const migration = await readFile(join(migrationsPath, name), 'utf8');
    await sql.begin(async (tx) => {
      for (const statement of migration.split(';').map((part) => part.trim()).filter(Boolean)) {
        await tx.unsafe(statement);
      }
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
    console.info(`Applied migration ${name}`);
  }
} finally {
  await sql.end();
}
