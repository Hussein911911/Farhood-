import { loadConfig } from './config.js';
import { assertSchemaReady } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { createPostgresNotifier } from './db/postgres-notifier.js';
import { PostgresRepository } from './db/postgres-repository.js';
import { createApp } from './app.js';
import { createLogger } from './logger.js';

const logger = createLogger();
let pool;
let notifier;
let server;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server?.listening) {
    logger.info('server_shutting_down', {});
    await new Promise((resolve) => server.close(resolve));
  }
  await notifier?.close();
  await pool?.end();
  logger.info('server_stopped', {});
}

async function main() {
  const config = loadConfig();
  pool = createPool(config, logger);
  await pool.query('SELECT 1');
  await assertSchemaReady(pool);
  notifier = await createPostgresNotifier(pool, logger);
  const repository = new PostgresRepository(pool);
  const app = createApp({ config, repository, logger, notifier });

  server = app.listen(config.port, config.host, () => {
    const address = server.address();
    logger.info('server_started', {
      host: config.host,
      port: typeof address === 'object' && address ? address.port : config.port,
      node_env: config.nodeEnv,
      database: 'postgresql',
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('error', (error) => {
    logger.error('server_error', { message: error.message });
    process.exitCode = 1;
    void shutdown();
  });
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

main().catch(async (error) => {
  logger.error('startup_failed', { message: error.message });
  process.exitCode = 1;
  await notifier?.close();
  await pool?.end();
});
