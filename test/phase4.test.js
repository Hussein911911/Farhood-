import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { assertSchemaReady, runMigrations } from '../src/db/migrate.js';
import { PostgresRepository } from '../src/db/postgres-repository.js';
import { ApiKeyService } from '../src/services/api-key-service.js';
import { Mt5AccountService } from '../src/services/mt5-account-service.js';
import { signNowPaymentsPayload } from '../src/services/payment-service.js';
import { generateSessionToken, hashSessionToken } from '../src/security/secrets.js';
import { createTestPool } from '../test-support/pglite-pool.js';

const apiKeyPepper = 'phase4-test-api-key-pepper-0123456789abcdef';
const sessionPepper = 'phase4-test-session-pepper-0123456789abcdef';
const mt5EncryptionKey = Buffer.alloc(32, 23).toString('base64');
const baseConfig = {
  nodeEnv: 'test', host: '127.0.0.1', port: 0, databaseUrl: 'postgres://pglite/phase4', dbPoolMax: 5,
  apiKeyPepper, sessionPepper, mt5EncryptionKey, minWalletBalanceUsd: 5, maxLot: 10,
  maxPendingSignals: 1000, bridgePollWaitMs: 100, bridgeLeaseMs: 10000, bridgeStaleMs: 30000,
  sessionTtlHours: 24, symbolMap: 'EURUSD:EURUSDm',
  subscriptionPricesUsd: { BASIC: 9.99, PLUS: 19.99, PRO: 49.99 },
};

let pool;
let repository;
let harness;

before(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  await assertSchemaReady(pool);
  repository = new PostgresRepository(pool);
});

after(async () => { await pool?.end(); });

async function startHarness({ config = baseConfig, paymentProvider, telegramClient } = {}) {
  const logs = [];
  const logger = {
    info: (event, fields) => logs.push({ level: 'info', event, fields }),
    warn: (event, fields) => logs.push({ level: 'warn', event, fields }),
    error: (event, fields) => logs.push({ level: 'error', event, fields }),
  };
  const app = createApp({ config, repository, logger, paymentProvider, telegramClient });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return { app, server, logs, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

beforeEach(async () => { harness = await startHarness(); });
afterEach(async () => {
  if (harness) await new Promise((resolve, reject) => harness.server.close((error) => error ? reject(error) : resolve()));
  harness = null;
});

async function request(path, options = {}) {
  return fetch(`${harness.baseUrl}${path}`, options);
}

function jsonOptions(body, headers = {}, method = 'POST') {
  return { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}

async function setSubscription(userId, { tier = 'PRO', status = 'ACTIVE', walletBalance = 100 } = {}) {
  await pool.query('UPDATE users SET subscription_tier = $2, wallet_balance = $3 WHERE id = $1', [userId, tier, walletBalance]);
  await pool.query(
    `INSERT INTO subscriptions (id,user_id,tier,status,starts_at)
     VALUES ($1,$2,$3,$4,now() - interval '1 hour')`,
    [randomUUID(), userId, tier, status],
  );
}

async function fixture({ walletBalance = 100, maxDailyDrawdown = 250 } = {}) {
  const user = await repository.createUser({ email: `phase4-${randomUUID()}@example.test`, passwordHash: 'not-a-real-password-hash' });
  await setSubscription(user.id, { walletBalance });
  const accounts = new Mt5AccountService({ repository, apiKeyPepper, mt5EncryptionKey });
  const account = await accounts.createForUser(user.id, {
    account_number: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    broker_server: 'Phase4-Demo-01',
    investor_password: 'fixture-investor-password',
  });
  const bot = await repository.createBotConfig({
    id: randomUUID(), userId: user.id, mt5AccountId: account.id, botName: 'Phase 4 EURUSD',
    maxDailyDrawdown, maxLotSize: 0.25, newsFilterEnabled: false, performanceFeeRate: 0.1,
  });
  const keys = new ApiKeyService({ repository, apiKeyPepper });
  const apiKey = await keys.createForUser(user.id, { botId: bot.id, label: 'phase4-test' });
  const sessionToken = generateSessionToken();
  await repository.createSession({ userId: user.id, tokenHash: hashSessionToken(sessionToken, sessionPepper), expiresAt: new Date(Date.now() + 3600000) });
  return { user, account, bot, apiKey, sessionHeaders: { authorization: `Bearer ${sessionToken}` } };
}

function signal(secret, action = 'BUY', overrides = {}) {
  return {
    secret_key: secret,
    signal_id: `phase4-${randomUUID()}`,
    action,
    symbol: 'EURUSD',
    lot: action === 'CLOSE' ? undefined : 0.05,
    stop_loss: action === 'CLOSE' ? null : 25,
    take_profit: action === 'CLOSE' ? null : 50,
    stop_loss_type: 'pips',
    take_profit_type: 'pips',
    ...overrides,
  };
}

function bridgeHeaders(account, bridgeKey) {
  return { authorization: `Bearer ${bridgeKey}`, 'x-bridge-id': account.bridge_id };
}

async function nextCommand(account, bridgeKey) {
  return request('/api/v1/mt5/commands/next?wait_ms=0', { headers: bridgeHeaders(account, bridgeKey) });
}

async function sendResult(account, bridgeKey, command, result = {}) {
  return request(`/api/v1/mt5/commands/${command.id}/result`, jsonOptions({
    lease_token: command.lease_token, success: true, retcode: 10009,
    order: '71001', deal: '81001', price: 1.0875, executed_lot: 0.05,
    profit_loss: 0, profit_loss_currency: 'USD', message: 'confirmed', ...result,
  }, bridgeHeaders(account, bridgeKey)));
}

test('schema readiness rejects an incomplete Phase 4 migration set', async () => {
  const migratedCoreTables = [
    'users', 'execution_commands', 'mt5_positions', 'wallet_transactions', 'payment_deposits',
    'notification_outbox', 'schema_migrations',
  ];
  const row = Object.fromEntries(migratedCoreTables.map((table) => [table, table]));
  await assert.rejects(
    assertSchemaReady({ query: async () => ({ rows: [row] }) }),
    /payment_webhook_events, telegram_links, telegram_connect_codes, telegram_updates/,
  );
});

async function setHarness(options) {
  await new Promise((resolve, reject) => harness.server.close((error) => error ? reject(error) : resolve()));
  harness = await startHarness(options);
}

test('creates USDT TRC20 deposit invoices and credits the wallet once after a signed finished IPN', async () => {
  const callbackSecret = 'phase4-nowpayments-ipn-secret';
  const quoteProvider = {
    createPayment: async ({ amountUsd, payCurrency, orderId }) => ({
      providerPaymentId: `np-${orderId}`,
      payAddress: 'TQm7VhMZQy3V4sExampleDepositAddress',
      payAmount: amountUsd * 1.001,
      payCurrency,
      status: 'WAITING',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }),
  };
  await setHarness({
    config: {
      ...baseConfig,
      nowPaymentsEnabled: true,
      nowPaymentsApiKey: 'test-provider-key',
      nowPaymentsIpnSecret: callbackSecret,
      nowPaymentsCallbackUrl: 'https://api.example.test/api/v1/payments/webhook',
      paymentMinUsd: 5,
      paymentMaxUsd: 10000,
    },
    paymentProvider: quoteProvider,
  });
  const user = await fixture({ walletBalance: 0 });
  const create = await request('/api/v1/payments/create-deposit', jsonOptions({ amount_usd: 25.5, network: 'TRC20' }, user.sessionHeaders));
  assert.equal(create.status, 201);
  const deposit = (await create.json()).deposit;
  assert.equal(deposit.network, 'TRC20');
  assert.equal(deposit.pay_currency, 'usdttrc20');
  assert.equal(deposit.pay_address, 'TQm7VhMZQy3V4sExampleDepositAddress');
  assert.ok(deposit.pay_amount > 25.5);
  const bep20Response = await request('/api/v1/payments/create-deposit', jsonOptions({ amount_usd: 5, network: 'BEP20' }, user.sessionHeaders));
  assert.equal(bep20Response.status, 201);
  assert.equal((await bep20Response.json()).deposit.pay_currency, 'usdtbsc');

  const event = {
    payment_id: `np-${deposit.order_id}`,
    payment_status: 'CONFIRMED',
    pay_address: deposit.pay_address,
    price_amount: '25.50',
    price_currency: 'usd',
    pay_amount: String(deposit.pay_amount),
    actually_paid: String(deposit.pay_amount),
    pay_currency: 'usdttrc20',
    order_id: deposit.order_id,
    payin_hash: 'trc20-demo-tx-1',
  };
  const invalidSignature = await request('/api/v1/payments/webhook', jsonOptions(event, { 'x-nowpayments-sig': '0'.repeat(128) }));
  assert.equal(invalidSignature.status, 401);
  assert.equal(Number((await pool.query('SELECT wallet_balance FROM users WHERE id=$1', [user.user.id])).rows[0].wallet_balance), 0);

  const confirmed = await request('/api/v1/payments/webhook', jsonOptions(event, { 'x-nowpayments-sig': signNowPaymentsPayload(event, callbackSecret) }));
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).status, 'CONFIRMED');
  assert.equal(Number((await pool.query('SELECT wallet_balance FROM users WHERE id=$1', [user.user.id])).rows[0].wallet_balance), 0);

  const finishedEvent = { ...event, payment_status: 'FINISHED' };
  const finished = await request('/api/v1/payments/webhook', jsonOptions(finishedEvent, { 'x-nowpayments-sig': signNowPaymentsPayload(finishedEvent, callbackSecret) }));
  assert.equal(finished.status, 200);
  assert.equal((await finished.json()).status, 'credited');
  assert.equal(Number((await pool.query('SELECT wallet_balance FROM users WHERE id=$1', [user.user.id])).rows[0].wallet_balance), 25.5);
  const ledger = await pool.query("SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE user_id=$1 AND transaction_type='TOP_UP'", [user.user.id]);
  assert.equal(ledger.rows[0].count, 1);

  const replay = await request('/api/v1/payments/webhook', jsonOptions(finishedEvent, { 'x-nowpayments-sig': signNowPaymentsPayload(finishedEvent, callbackSecret) }));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).status, 'duplicate');
  assert.equal(Number((await pool.query('SELECT wallet_balance FROM users WHERE id=$1', [user.user.id])).rows[0].wallet_balance), 25.5);
  const billing = await (await request('/api/v1/billing/overview', { headers: user.sessionHeaders })).json();
  assert.equal(billing.deposits.find((item) => item.id === deposit.id)?.status, 'FINISHED');
  assert.equal(billing.wallet_transactions[0].transaction_type, 'TOP_UP');
});

test('does not charge a USD performance fee when an MT5 fill omits its P/L currency', async () => {
  const user = await fixture({ walletBalance: 100 });
  const close = await request('/api/v1/webhook', jsonOptions(signal(user.apiKey.secret_key, 'CLOSE')));
  assert.equal(close.status, 202);
  const command = await (await nextCommand(user.account, user.account.bridge_key)).json();
  const result = await sendResult(user.account, user.account.bridge_key, command, {
    profit_loss: 50,
    profit_loss_currency: undefined,
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).performance_fee_deducted, 0);
  const trade = await pool.query('SELECT profit_loss_currency,performance_fee_deducted FROM trade_logs WHERE command_id=$1', [command.id]);
  assert.equal(trade.rows[0].profit_loss_currency, 'UNK');
  assert.equal(Number(trade.rows[0].performance_fee_deducted), 0);
  assert.equal(Number((await pool.query('SELECT wallet_balance FROM users WHERE id=$1', [user.user.id])).rows[0].wallet_balance), 100);
  const fees = await pool.query("SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE user_id=$1 AND transaction_type='PERFORMANCE_FEE'", [user.user.id]);
  assert.equal(fees.rows[0].count, 0);
});

test('charges subscription upgrades and renewals atomically, and marks insufficient renewal balance past due', async () => {
  const user = await fixture({ walletBalance: 100 });
  await pool.query("UPDATE users SET subscription_tier='BASIC', wallet_balance=100 WHERE id=$1", [user.user.id]);
  await pool.query("UPDATE subscriptions SET tier='BASIC' WHERE user_id=$1 AND status='ACTIVE'", [user.user.id]);
  const upgrade = await request('/api/v1/subscriptions/upgrade', jsonOptions({ tier: 'PRO' }, user.sessionHeaders));
  assert.equal(upgrade.status, 201, JSON.stringify({ body: await upgrade.clone().json().catch(() => null), logs: harness.logs }));
  const upgraded = await upgrade.json();
  assert.equal(upgraded.subscription.tier, 'PRO');
  assert.equal(Number(upgraded.wallet_balance), 50.01);
  const charge = await pool.query(
    "SELECT amount_usd FROM wallet_transactions WHERE user_id=$1 AND transaction_type='SUBSCRIPTION_CHARGE'",
    [user.user.id],
  );
  assert.equal(Number(charge.rows[0].amount_usd), -49.99);
  const duplicateUpgrade = await request('/api/v1/subscriptions/upgrade', jsonOptions({ tier: 'PRO' }, user.sessionHeaders));
  assert.equal(duplicateUpgrade.status, 409);

  await pool.query('UPDATE users SET wallet_balance=100 WHERE id=$1', [user.user.id]);
  await pool.query(
    "UPDATE subscriptions SET starts_at=now()-interval '1 month',ends_at=now()-interval '1 minute' WHERE id=$1",
    [upgraded.subscription.id],
  );
  const renewed = await harness.app.locals.services.billingService.renewDueSubscriptions();
  assert.equal(renewed.length, 1);
  assert.equal(renewed[0].kind, 'renewed');
  const current = await pool.query("SELECT tier,status FROM subscriptions WHERE user_id=$1 AND status='ACTIVE'", [user.user.id]);
  assert.equal(current.rows.length, 1);
  assert.equal(current.rows[0].tier, 'PRO');
  assert.equal(Number((await pool.query('SELECT wallet_balance FROM users WHERE id=$1', [user.user.id])).rows[0].wallet_balance), 50.01);
  const renewLedger = await pool.query("SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE user_id=$1 AND transaction_type='SUBSCRIPTION_RENEWAL'", [user.user.id]);
  assert.equal(renewLedger.rows[0].count, 1);

  const low = await fixture({ walletBalance: 4 });
  await pool.query(
    `UPDATE subscriptions SET monthly_price_usd=9.99,ends_at=now()-interval '1 minute'
     WHERE user_id=$1 AND status='ACTIVE'`,
    [low.user.id],
  );
  const lowResult = await harness.app.locals.services.billingService.renewDueSubscriptions();
  assert.ok(lowResult.some((item) => item.kind === 'insufficient_balance'));
  const pastDue = await pool.query("SELECT status FROM subscriptions WHERE user_id=$1 AND status='PAST_DUE'", [low.user.id]);
  assert.equal(pastDue.rows.length, 1);
  assert.equal((await pool.query('SELECT is_active FROM bots_config WHERE id=$1', [low.bot.id])).rows[0].is_active, false);
  assert.ok((await pool.query("SELECT 1 FROM notification_outbox WHERE user_id=$1 AND event_type='SUBSCRIPTION_PAYMENT_FAILED'", [low.user.id])).rows.length);
});

test('pauses entry execution below the wallet minimum but still lets risk-reducing closes reach the EA', async () => {
  const user = await fixture({ walletBalance: 100 });
  const accepted = await request('/api/v1/webhook', jsonOptions(signal(user.apiKey.secret_key)));
  assert.equal(accepted.status, 202);
  const queued = await accepted.json();
  await pool.query('UPDATE users SET wallet_balance=4 WHERE id=$1', [user.user.id]);
  const noEntry = await nextCommand(user.account, user.account.bridge_key);
  assert.equal(noEntry.status, 204);
  const failed = await pool.query('SELECT status FROM execution_commands WHERE id=$1', [queued.id]);
  assert.equal(failed.rows[0].status, 'FAILED');
  assert.equal((await pool.query('SELECT is_active FROM bots_config WHERE id=$1', [user.bot.id])).rows[0].is_active, false);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM notification_outbox WHERE user_id=$1 AND event_type='LOW_WALLET_BALANCE'", [user.user.id])).rows[0].count, 1);

  const close = await request('/api/v1/webhook', jsonOptions(signal(user.apiKey.secret_key, 'CLOSE')));
  assert.equal(close.status, 202);
  const closeCommand = await (await nextCommand(user.account, user.account.bridge_key)).json();
  assert.equal(closeCommand.action, 'CLOSE');
});

test('daily drawdown pauses a bot and queues one Telegram-ready risk notification', async () => {
  const user = await fixture({ maxDailyDrawdown: 5 });
  const closeResponse = await request('/api/v1/webhook', jsonOptions(signal(user.apiKey.secret_key, 'CLOSE')));
  assert.equal(closeResponse.status, 202);
  const command = await (await nextCommand(user.account, user.account.bridge_key)).json();
  const result = await sendResult(user.account, user.account.bridge_key, command, { profit_loss: -6 });
  assert.equal(result.status, 200);

  const blocked = await request('/api/v1/webhook', jsonOptions(signal(user.apiKey.secret_key, 'BUY')));
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, 'daily_drawdown_limit');
  assert.equal((await pool.query('SELECT is_active FROM bots_config WHERE id=$1', [user.bot.id])).rows[0].is_active, false);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM notification_outbox WHERE user_id=$1 AND event_type='DAILY_DRAWDOWN'", [user.user.id])).rows[0].count, 1);
});

test('links Telegram with a short-lived one-time code and dispatches outbox notifications', async () => {
  const callbackSecret = 'phase4-telegram-secret';
  const delivered = [];
  const client = {
    configured: true,
    sendMessage: async (chatId, text) => { delivered.push({ chatId, text }); return { message_id: delivered.length }; },
  };
  await setHarness({
    config: {
      ...baseConfig,
      telegramEnabled: true,
      telegramBotToken: 'telegram-test-token',
      telegramBotUsername: 'farhood_test_bot',
      telegramWebhookSecret: callbackSecret,
      telegramConnectCodeTtlMinutes: 15,
    },
    telegramClient: client,
  });
  const user = await fixture();
  const generated = await request('/api/v1/telegram/connect-code', jsonOptions({}, user.sessionHeaders));
  assert.equal(generated.status, 201);
  const connect = await generated.json();
  assert.match(connect.code, /^fh_/);
  assert.equal(connect.bot_username, 'farhood_test_bot');
  assert.ok(connect.deep_link.includes(connect.code));

  const update = {
    update_id: 990001,
    message: { chat: { id: 778899001, type: 'private' }, text: `/start ${connect.code}` },
  };
  const linked = await request('/api/v1/notifications/telegram/webhook', jsonOptions(update, {
    'x-telegram-bot-api-secret-token': callbackSecret,
  }));
  assert.equal(linked.status, 200);
  assert.equal((await linked.json()).status, 'connected');
  const duplicate = await request('/api/v1/notifications/telegram/webhook', jsonOptions(update, {
    'x-telegram-bot-api-secret-token': callbackSecret,
  }));
  assert.equal((await duplicate.json()).status, 'duplicate');

  for (let attempt = 0; attempt < 20 && !delivered.length; attempt++) {
    await harness.app.locals.services.telegramWorker.runBatch();
  }
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].text, /alerts are connected/i);

  const closeResponse = await request('/api/v1/webhook', jsonOptions(signal(user.apiKey.secret_key, 'CLOSE')));
  assert.equal(closeResponse.status, 202);
  const closeCommand = await (await nextCommand(user.account, user.account.bridge_key)).json();
  const closeResult = await sendResult(user.account, user.account.bridge_key, closeCommand, { profit_loss: 10 });
  assert.equal(closeResult.status, 200);
  for (let attempt = 0; attempt < 20 && delivered.length < 2; attempt++) {
    await harness.app.locals.services.telegramWorker.runBatch();
  }
  assert.equal(delivered.length, 2);
  assert.match(delivered[1].text, /Trade closed/i);
  assert.match(delivered[1].text, /Performance fee: USD 1\.00/i);

  const billing = await (await request('/api/v1/billing/overview', { headers: user.sessionHeaders })).json();
  assert.equal(billing.telegram_linked, true);

  const stopUpdate = { update_id: 990002, message: { chat: { id: 778899001, type: 'private' }, text: '/stop' } };
  const stopped = await request('/api/v1/notifications/telegram/webhook', jsonOptions(stopUpdate, {
    'x-telegram-bot-api-secret-token': callbackSecret,
  }));
  assert.equal((await stopped.json()).status, 'disconnected');
  assert.equal((await (await request('/api/v1/billing/overview', { headers: user.sessionHeaders })).json()).telegram_linked, false);
});
