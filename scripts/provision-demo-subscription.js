import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';

const [userId, tier = 'PRO', walletText = '100.00'] = process.argv.slice(2);
const allowedTiers = new Set(['BASIC', 'PLUS', 'PRO']);
if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  console.error('Usage: npm run demo:provision -- <user-uuid> [BASIC|PLUS|PRO] [wallet-usd]');
  process.exit(2);
}
if (!allowedTiers.has(tier)) {
  console.error('Tier must be BASIC, PLUS, or PRO.');
  process.exit(2);
}
const walletBalance = Number(walletText);
if (!Number.isFinite(walletBalance) || walletBalance < 0 || walletBalance > 100000000) {
  console.error('wallet-usd must be between 0 and 100000000.');
  process.exit(2);
}

let pool;
try {
  const config = loadConfig();
  if (config.nodeEnv === 'production') throw new Error('Demo provisioning is disabled in production');
  pool = createPool(config);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user.rows[0]) throw new Error('User not found');
    await client.query(
      `UPDATE subscriptions SET status = 'CANCELED', updated_at = now()
       WHERE user_id = $1 AND status IN ('ACTIVE', 'TRIAL')`,
      [userId],
    );
    await client.query(
      `UPDATE users SET subscription_tier = $2, wallet_balance = $3, updated_at = now() WHERE id = $1`,
      [userId, tier, walletBalance],
    );
    await client.query(
      `INSERT INTO subscriptions (id, user_id, tier, status, starts_at)
       VALUES ($1, $2, $3, 'ACTIVE', now())`,
      [randomUUID(), userId, tier],
    );
    await client.query('COMMIT');
    console.log(`Provisioned local demo subscription: user=${userId}, tier=${tier}, wallet_usd=${walletBalance.toFixed(2)}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(`Demo provisioning failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
