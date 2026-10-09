import dotenv from 'dotenv';
import { decodeAes256Key } from './security/encryption.js';

dotenv.config();

const DEMO_MARKERS = ['local-demo', 'change-me', 'replace-with'];
const DEFAULT_SUBSCRIPTION_PRICES = Object.freeze({ BASIC: 9.99, PLUS: 19.99, PRO: 49.99 });

function integerFromEnv(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function positiveNumberFromEnv(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a number between ${min} and ${max}`);
  return value;
}

function booleanFromEnv(env, name, fallback = false) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function subscriptionPricesFromEnv(raw) {
  if (!raw) return DEFAULT_SUBSCRIPTION_PRICES;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SUBSCRIPTION_PRICES_USD must be a JSON object with BASIC, PLUS, and PRO prices');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SUBSCRIPTION_PRICES_USD must be a JSON object with BASIC, PLUS, and PRO prices');
  }
  const prices = {};
  for (const tier of Object.keys(DEFAULT_SUBSCRIPTION_PRICES)) {
    const amount = Number(parsed[tier]);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000 || Math.round(amount * 100) !== amount * 100) {
      throw new Error(`SUBSCRIPTION_PRICES_USD.${tier} must be a positive price with up to two decimal places`);
    }
    prices[tier] = amount;
  }
  if (Object.keys(parsed).some((tier) => !Object.hasOwn(DEFAULT_SUBSCRIPTION_PRICES, tier))) {
    throw new Error('SUBSCRIPTION_PRICES_USD may contain only BASIC, PLUS, and PRO');
  }
  return Object.freeze(prices);
}

function nowPaymentsBaseUrlFromEnv(raw) {
  const value = raw || 'https://api.nowpayments.io/v1';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('NOWPAYMENTS_API_BASE_URL must be a NOWPayments HTTPS API URL');
  }
  const trustedHosts = new Set(['api.nowpayments.io', 'api-sandbox.nowpayments.io']);
  if (url.protocol !== 'https:' || !trustedHosts.has(url.hostname) || url.pathname.replace(/\/$/, '') !== '/v1'
    || url.username || url.password || url.search || url.hash) {
    throw new Error('NOWPAYMENTS_API_BASE_URL must use the official NOWPayments HTTPS API host and /v1 path');
  }
  return `${url.origin}/v1`;
}

function validateOptionalHttpsUrl(raw, name) {
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without credentials or a fragment`);
  }
  return url.toString();
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

  const minWalletBalanceUsd = positiveNumberFromEnv(env, 'MIN_WALLET_BALANCE_USD', 5, { min: 0.01, max: 1000000 });
  const freeTrialDays = integerFromEnv(env, 'FREE_TRIAL_DAYS', 15, { min: 1, max: 90 });
  const freeTrialCreditUsd = positiveNumberFromEnv(env, 'FREE_TRIAL_CREDIT_USD', 10, { min: 0, max: 10000 });
  const performanceFeesEnabled = booleanFromEnv(env, 'PERFORMANCE_FEES_ENABLED', false);
  if (freeTrialCreditUsd < minWalletBalanceUsd) {
    throw new Error('FREE_TRIAL_CREDIT_USD must be at least MIN_WALLET_BALANCE_USD');
  }
  const maxLot = positiveNumberFromEnv(env, 'MAX_LOT', 100, { min: Number.EPSILON });
  const nowPaymentsApiKey = env.NOWPAYMENTS_API_KEY?.trim() || '';
  const nowPaymentsIpnSecret = env.NOWPAYMENTS_IPN_SECRET?.trim() || '';
  const nowPaymentsCallbackUrl = validateOptionalHttpsUrl(env.NOWPAYMENTS_CALLBACK_URL?.trim() || '', 'NOWPAYMENTS_CALLBACK_URL');
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const telegramWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim() || '';
  if (telegramWebhookSecret && !/^[A-Za-z0-9_-]{1,256}$/.test(telegramWebhookSecret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET must be 1-256 characters using letters, numbers, underscore, or dash');
  }

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
    freeTrialDays,
    freeTrialCreditUsd,
    performanceFeesEnabled,
    maxLot,
    maxPendingSignals: integerFromEnv(env, 'MAX_PENDING_SIGNALS', 10000, { min: 1, max: 1000000 }),
    bridgePollWaitMs: integerFromEnv(env, 'BRIDGE_POLL_WAIT_MS', 20000, { min: 0, max: 25000 }),
    bridgeLeaseMs: integerFromEnv(env, 'BRIDGE_LEASE_MS', 60000, { min: 10000, max: 3600000 }),
    bridgeStaleMs: integerFromEnv(env, 'BRIDGE_STALE_MS', 45000, { min: 5000, max: 3600000 }),
    sessionTtlHours: integerFromEnv(env, 'SESSION_TTL_HOURS', 24, { min: 1, max: 720 }),
    nowPaymentsApiKey,
    nowPaymentsBaseUrl: nowPaymentsBaseUrlFromEnv(env.NOWPAYMENTS_API_BASE_URL?.trim()),
    nowPaymentsIpnSecret,
    nowPaymentsCallbackUrl,
    nowPaymentsEnabled: Boolean(nowPaymentsApiKey && nowPaymentsIpnSecret && nowPaymentsCallbackUrl),
    paymentMinUsd: positiveNumberFromEnv(env, 'PAYMENT_MIN_USD', 5, { min: 1, max: 1000000 }),
    paymentMaxUsd: positiveNumberFromEnv(env, 'PAYMENT_MAX_USD', 10000, { min: 1, max: 1000000 }),
    subscriptionPricesUsd: subscriptionPricesFromEnv(env.SUBSCRIPTION_PRICES_USD),
    telegramBotToken,
    telegramBotUsername: (env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '').trim(),
    telegramWebhookSecret,
    telegramEnabled: Boolean(telegramBotToken && telegramWebhookSecret),
    telegramConnectCodeTtlMinutes: integerFromEnv(env, 'TELEGRAM_CONNECT_CODE_TTL_MINUTES', 15, { min: 1, max: 60 }),
    symbolMap: env.SYMBOL_MAP || '',
  });
}
