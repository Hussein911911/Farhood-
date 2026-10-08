import { PollNotifier } from '../notifier.js';

const CHANNEL = 'farhood_execution_commands';

export async function createPostgresNotifier(pool, logger = console) {
  const connection = await pool.connect();
  const notifier = new PollNotifier();
  const onNotification = (message) => {
    if (message.channel === CHANNEL) notifier.notify(message.payload || '*');
  };
  connection.on('notification', onNotification);
  connection.on('error', (error) => {
    if (typeof logger.error === 'function') {
      logger.error('postgres_notification_connection_error', { message: error.message });
    }
  });
  try {
    await connection.query(`LISTEN ${CHANNEL}`);
  } catch (error) {
    connection.removeListener('notification', onNotification);
    connection.release();
    throw error;
  }

  notifier.close = async () => {
    connection.removeListener('notification', onNotification);
    await connection.query(`UNLISTEN ${CHANNEL}`).catch(() => {});
    connection.release();
  };
  return notifier;
}
