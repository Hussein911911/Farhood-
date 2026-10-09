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
           to_regclass('public.wallet_transactions') AS wallet_transactions,
           to_regclass('public.payment_deposits') AS payment_deposits,
           to_regclass('public.payment_webhook_events') AS payment_webhook_events,
           to_regclass('public.telegram_links') AS telegram_links,
           to_regclass('public.telegram_connect_codes') AS telegram_connect_codes,
           to_regclass('public.telegram_updates') AS telegram_updates,
           to_regclass('public.notification_outbox') AS notification_outbox,
           to_regclass('public.schema_migrations') AS schema_migrations,
           (SELECT COUNT(*) = 4 FROM information_schema.columns
            WHERE table_schema = 'public' AND (
              (table_name = 'users' AND column_name = 'demo_trial_credit_usd') OR
              (table_name = 'mt5_accounts' AND column_name IN ('reported_trade_mode', 'trade_mode_reported_at')) OR
              (table_name = 'execution_commands' AND column_name = 'performance_fee_exempt')
            )) AS trial_access_ready
  `);
  const row = result.rows[0];
  const requiredTables = [
    'users', 'execution_commands', 'mt5_positions', 'wallet_transactions', 'payment_deposits',
    'payment_webhook_events', 'telegram_links', 'telegram_connect_codes', 'telegram_updates',
    'notification_outbox', 'schema_migrations',
  ];
  const missingTables = requiredTables.filter((table) => !row?.[table]);
  if (!row?.trial_access_ready) missingTables.push('trial_access_fields');
  if (missingTables.length > 0) {
    throw new Error(`Database schema is not initialized (missing: ${missingTables.join(', ')}). Run \`npm run db:migrate\` first.`);
  }
}
