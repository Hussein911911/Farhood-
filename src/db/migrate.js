import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const MIGRATION_LOCK_ID = 5419202601;

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function runMigrations(pool, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();
  const applied = [];

  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (exists.rowCount === 0) {
        const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
        for (const statement of splitStatements(sql)) await client.query(statement);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
        applied.push(file);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    } finally {
      client.release();
    }
  }
  return applied;
}

export async function assertSchemaReady(pool) {
  const result = await pool.query(`
    SELECT to_regclass('public.users') AS users,
           to_regclass('public.execution_commands') AS execution_commands,
           to_regclass('public.mt5_positions') AS mt5_positions,
           to_regclass('public.schema_migrations') AS schema_migrations
  `);
  const row = result.rows[0];
  if (!row?.users || !row?.execution_commands || !row?.mt5_positions || !row?.schema_migrations) {
    throw new Error('Database schema is not initialized. Run `npm run db:migrate` first.');
  }
}
