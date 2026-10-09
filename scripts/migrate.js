import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';

let pool;
try {
  const config = loadConfig();
  pool = createPool(config);
  await pool.query('SELECT 1');
  const applied = await runMigrations(pool);
  if (applied.length === 0) console.log('Database schema is already up to date.');
  else for (const migration of applied) console.log(`Applied migration ${migration}`);
} catch (error) {
  console.error(`Database migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
