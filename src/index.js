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
let billingTimer;
let notificationTimer;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server?.listening) {
    logger.info('server_shutting_down', {});
    await new Promise((resolve) => server.close(resolve));
  }
  clearInterval(billingTimer);
  clearInterval(notificationTimer);
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

  const { billingService, telegramWorker } = app.locals.services;
  let renewalRunning = false;
  let notificationRunning = false;
  const runRenewals = async () => {
    if (renewalRunning) return;
    renewalRunning = true;
    try {
      const outcomes = await billingService.renewDueSubscriptions();
      if (outcomes.length) logger.info('subscription_renewals_processed', { count: outcomes.length, outcomes });
    } catch (error) {
      logger.error('subscription_renewal_worker_failed', { message: error.message });
    } finally {
      renewalRunning = false;
    }
  };
  const runNotifications = async () => {
    if (notificationRunning) return;
    notificationRunning = true;
    try {
      await telegramWorker.runBatch();
    } catch (error) {
      logger.error('telegram_notification_worker_failed', { message: error.message });
    } finally {
      notificationRunning = false;
    }
  };
  void runRenewals();
  void runNotifications();
  billingTimer = setInterval(() => void runRenewals(), 60_000);
  notificationTimer = setInterval(() => void runNotifications(), 1500);
  billingTimer.unref();
  notificationTimer.unref();

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
