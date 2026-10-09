import pg from 'pg';

const { Pool } = pg;

export function createPool(config, logger = console) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'farhood-trading-engine',
  });
  pool.on('error', (error) => {
    if (typeof logger.error === 'function') logger.error('postgres_idle_client_error', { message: error.message });
  });
  return pool;
}
