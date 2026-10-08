import dotenv from 'dotenv';
import { decodeAes256Key } from './security/encryption.js';

dotenv.config();

const DEMO_MARKERS = ['local-demo', 'change-me', 'replace-with'];

function integerFromEnv(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function positiveNumberFromEnv(env, name, fallback, { min = 0 } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) throw new Error(`${name} must be a number >= ${min}`);
  return value;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const databaseUrl = env.DATABASE_URL || '';
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }

  const apiKeyPepper = env.API_KEY_PEPPER || '';
  const sessionPepper = env.SESSION_PEPPER || '';
  const mt5EncryptionKey = env.MT5_ENCRYPTION_KEY || '';
  if (apiKeyPepper.length < 32) throw new Error('API_KEY_PEPPER must contain at least 32 characters');
  if (sessionPepper.length < 32) throw new Error('SESSION_PEPPER must contain at least 32 characters');
  decodeAes256Key(mt5EncryptionKey);

  if (nodeEnv === 'production') {
    for (const [name, value] of [['API_KEY_PEPPER', apiKeyPepper], ['SESSION_PEPPER', sessionPepper]]) {
      if (DEMO_MARKERS.some((marker) => value.toLowerCase().includes(marker))) {
        throw new Error(`${name} must not use a demo/example value in production`);
      }
    }
    const decodedEncryptionKey = Buffer.from(mt5EncryptionKey, /^[0-9a-fA-F]{64}$/.test(mt5EncryptionKey) ? 'hex' : 'base64').toString('utf8');
    if (DEMO_MARKERS.some((marker) => decodedEncryptionKey.toLowerCase().includes(marker))) {
      throw new Error('MT5_ENCRYPTION_KEY must not use a demo/example value in production');
    }
  }

  const minWalletBalanceUsd = positiveNumberFromEnv(env, 'MIN_WALLET_BALANCE_USD', 0.01);
  const maxLot = positiveNumberFromEnv(env, 'MAX_LOT', 100, { min: Number.EPSILON });

  return Object.freeze({
    nodeEnv,
    host: env.HOST || '127.0.0.1',
    port: integerFromEnv(env, 'PORT', 3000, { min: 0, max: 65535 }),
    databaseUrl,
    dbPoolMax: integerFromEnv(env, 'DB_POOL_MAX', 10, { min: 2, max: 100 }),
    apiKeyPepper,
    sessionPepper,
    mt5EncryptionKey,
    minWalletBalanceUsd,
    maxLot,
    maxPendingSignals: integerFromEnv(env, 'MAX_PENDING_SIGNALS', 10000, { min: 1, max: 1000000 }),
    bridgePollWaitMs: integerFromEnv(env, 'BRIDGE_POLL_WAIT_MS', 20000, { min: 0, max: 25000 }),
    bridgeLeaseMs: integerFromEnv(env, 'BRIDGE_LEASE_MS', 60000, { min: 10000, max: 3600000 }),
    bridgeStaleMs: integerFromEnv(env, 'BRIDGE_STALE_MS', 45000, { min: 5000, max: 3600000 }),
    sessionTtlHours: integerFromEnv(env, 'SESSION_TTL_HOURS', 24, { min: 1, max: 720 }),
  });
}
