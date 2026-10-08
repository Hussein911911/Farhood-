import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { PostgresRepository } from '../src/db/postgres-repository.js';
import { ApiKeyService } from '../src/services/api-key-service.js';
import { Mt5AccountService } from '../src/services/mt5-account-service.js';
import { generateSessionToken, hashApiKey, hashSessionToken } from '../src/security/secrets.js';
import { decryptMt5InvestorPassword } from '../src/security/encryption.js';
import { createTestPool } from '../test-support/pglite-pool.js';
import { signNowPaymentsPayload } from '../src/services/payment-service.js';

const apiKeyPepper = 'test-api-key-pepper-0123456789abcdef-xyz';
const sessionPepper = 'test-session-pepper-0123456789abcdef-xyz';
const mt5EncryptionKey = Buffer.alloc(32, 7).toString('base64');
const config = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  databaseUrl: 'postgres://pglite/test',
  dbPoolMax: 5,
  apiKeyPepper,
  sessionPepper,
  mt5EncryptionKey,
  minWalletBalanceUsd: 0.01,
  maxLot: 10,
  maxPendingSignals: 1000,
  bridgePollWaitMs: 100,
  bridgeLeaseMs: 10000,
  bridgeStaleMs: 30000,
  sessionTtlHours: 24,
  symbolMap: 'EURUSD:EURUSDm',
};

let pool;
let repository;
let harness;

before(async () => {
  pool = await createTestPool();
  await runMigrations(pool);
  repository = new PostgresRepository(pool);
});

after(async () => {
  await pool?.end();
});

async function startHarness({ config: testConfig = config, paymentProvider, telegramClient } = {}) {
  const logs = [];
  const logger = {
    info: (event, fields) => logs.push({ level: 'info', event, fields }),
    warn: (event, fields) => logs.push({ level: 'warn', event, fields }),
    error: (event, fields) => logs.push({ level: 'error', event, fields }),
  };
  const app = createApp({ config: testConfig, repository, logger, paymentProvider, telegramClient });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server, logs, app, config: testConfig };
}

beforeEach(async () => {
  harness = await startHarness();
});

async function replaceHarness(options) {
  await new Promise((resolve, reject) => harness.server.close((error) => error ? reject(error) : resolve()));
  harness = await startHarness(options);
}

afterEach(async () => {
  if (!harness) return;
  await new Promise((resolve, reject) => harness.server.close((error) => error ? reject(error) : resolve()));
  harness = null;
});

async function request(path, options = {}) {
  return fetch(`${harness.baseUrl}${path}`, options);
}

function jsonOptions(body, headers = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

async function setSubscription(userId, { tier = 'PRO', status = 'ACTIVE', walletBalance = 100 } = {}) {
  await pool.query('UPDATE users SET subscription_tier = $2, wallet_balance = $3 WHERE id = $1', [userId, tier, walletBalance]);
  await pool.query(
    `INSERT INTO subscriptions (id, user_id, tier, status, starts_at)
     VALUES ($1, $2, $3, $4, now() - interval '1 hour')`,
    [randomUUID(), userId, tier, status],
  );
}

async function provisionUser({ subscriptionStatus = 'ACTIVE', walletBalance = 100, maxLotSize = 0.5 } = {}) {
  const user = await repository.createUser({
    email: `fixture-${randomUUID()}@example.test`,
    passwordHash: 'fixture-password-hash',
  });
  await setSubscription(user.id, { status: subscriptionStatus, walletBalance });

  const accounts = new Mt5AccountService({ repository, apiKeyPepper, mt5EncryptionKey });
  const account = await accounts.createForUser(user.id, {
    account_number: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    broker_server: 'Demo-Broker-01',
    investor_password: 'read-only-investor-password',
  });
  const bot = await repository.createBotConfig({
    id: randomUUID(),
    userId: user.id,
    mt5AccountId: account.id,
    botName: 'Test bot',
    maxDailyDrawdown: 250,
    maxLotSize,
    newsFilterEnabled: false,
    performanceFeeRate: 0.2,
  });
  const apiKeys = new ApiKeyService({ repository, apiKeyPepper });
  const apiKey = await apiKeys.createForUser(user.id, { botId: bot.id });
  return { user, account, bot, apiKey };
}

async function createSessionForUser(userId) {
  const token = generateSessionToken();
  await repository.createSession({
    userId,
    tokenHash: hashSessionToken(token, sessionPepper),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return token;
}

function webhookPayload(secretKey, overrides = {}) {
  return {
    secret_key: secretKey,
    signal_id: `signal-${randomUUID()}`,
    action: 'BUY',
    symbol: 'EURUSD',
    lot: 0.1,
    stop_loss: 30,
    take_profit: 60,
    stop_loss_type: 'pips',
    take_profit_type: 'pips',
    ...overrides,
  };
}

function bridgeHeaders(account, bridgeKey) {
  return {
    authorization: `Bearer ${bridgeKey}`,
    'x-bridge-id': account.bridge_id,
  };
}

async function nextCommand(account, bridgeKey) {
  return request('/api/v1/mt5/commands/next?wait_ms=0', {
    headers: bridgeHeaders(account, bridgeKey),
  });
}

async function sendResult(account, bridgeKey, command, result) {
  return request(`/api/v1/mt5/commands/${command.id}/result`, jsonOptions({
    lease_token: command.lease_token,
    success: true,
    retcode: 10009,
    order: '123456',
    deal: '654321',
    price: 1.1,
    executed_lot: 0.1,
    profit_loss: 0,
    profit_loss_currency: 'USD',
    message: 'Done',
    ...result,
  }, bridgeHeaders(account, bridgeKey)));
}

test('registers sessions, encrypts MT5 data, hashes user API keys, then logs trades and deducts fees', async () => {
  const email = `owner-${randomUUID()}@example.test`;
  const password = 'Correct-Horse-Battery-42!';
  const register = await request('/api/v1/auth/register', jsonOptions({ email, password }));
  assert.equal(register.status, 201);
  const registeredUser = (await register.json()).user;
  assert.equal(registeredUser.email, email.toLowerCase());
  assert.equal(registeredUser.wallet_balance, 0);

  const login = await request('/api/v1/auth/login', jsonOptions({ email, password }));
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.token_type, 'Bearer');
  const storedSession = await pool.query('SELECT token_hash FROM user_sessions WHERE user_id = $1', [registeredUser.id]);
  assert.equal(storedSession.rows.length, 1);
  assert.equal(storedSession.rows[0].token_hash, hashSessionToken(session.access_token, sessionPepper));
  assert.notEqual(storedSession.rows[0].token_hash, session.access_token);
  const storedPassword = await pool.query('SELECT password_hash FROM users WHERE id = $1', [registeredUser.id]);
  assert.notEqual(storedPassword.rows[0].password_hash, password);
  const sessionHeaders = { authorization: `Bearer ${session.access_token}` };

  const accountResponse = await request('/api/v1/mt5-accounts', jsonOptions({
    account_number: '987654321',
    broker_server: 'Demo-Broker-01',
    investor_password: 'investor-secret-not-plaintext',
  }, sessionHeaders));
  assert.equal(accountResponse.status, 201);
  const account = await accountResponse.json();
  assert.ok(account.bridge_id);
  assert.ok(account.bridge_key);
  assert.equal(account.connection_status, 'DISCONNECTED');
  const encryptedRow = await pool.query('SELECT investor_password_encrypted FROM mt5_accounts WHERE id = $1', [account.id]);
  assert.equal(decryptMt5InvestorPassword(Buffer.from(encryptedRow.rows[0].investor_password_encrypted), mt5EncryptionKey), 'investor-secret-not-plaintext');
  const accountList = await (await request('/api/v1/mt5-accounts', { headers: sessionHeaders })).json();
  assert.equal(JSON.stringify(accountList).includes('investor-secret-not-plaintext'), false);
  assert.equal(JSON.stringify(accountList).includes(account.bridge_key), false);

  const botResponse = await request('/api/v1/bots', jsonOptions({
    mt5_account_id: account.id,
    bot_name: 'Crossover EURUSD',
    max_daily_drawdown: 250,
    max_lot_size: 0.25,
    performance_fee_rate: 0.2,
  }, sessionHeaders));
  assert.equal(botResponse.status, 201);
  const bot = (await botResponse.json()).bot;

  const keyResponse = await request('/api/v1/api-keys', jsonOptions({ label: 'TradingView', bot_id: bot.id }, sessionHeaders));
  assert.equal(keyResponse.status, 201);
  const apiKey = await keyResponse.json();
  assert.ok(apiKey.secret_key);
  assert.equal(apiKey.bot_id, bot.id);
  const storedHash = await pool.query('SELECT secret_key_hash FROM api_keys WHERE id = $1', [apiKey.id]);
  assert.equal(storedHash.rows[0].secret_key_hash, hashApiKey(apiKey.secret_key, apiKeyPepper));
  const listedKeys = await (await request('/api/v1/api-keys', { headers: sessionHeaders })).json();
  assert.equal(JSON.stringify(listedKeys).includes(apiKey.secret_key), false);
  assert.equal(JSON.stringify(listedKeys).includes('secret_key_hash'), false);

  await setSubscription(registeredUser.id, { tier: 'PRO', status: 'ACTIVE', walletBalance: 100 });

  const buyResponse = await request('/api/v1/webhook', jsonOptions(webhookPayload(apiKey.secret_key, {
    signal_id: 'integration-buy-1',
  })));
  const buyBody = await buyResponse.json();
  assert.equal(buyResponse.status, 202, JSON.stringify({ buyBody, logs: harness.logs }));
  assert.equal(buyBody.status, 'QUEUED');

  const buyCommandResponse = await nextCommand(account, account.bridge_key);
  assert.equal(buyCommandResponse.status, 200);
  const buyCommand = await buyCommandResponse.json();
  assert.equal(buyCommand.symbol, 'EURUSDm');
  assert.equal(buyCommand.action, 'BUY');
  const buyAck = await sendResult(account, account.bridge_key, buyCommand, {
    order: '50001', deal: '60001', executed_lot: 0.1,
  });
  assert.equal(buyAck.status, 200);
  assert.equal((await buyAck.json()).trade_logged, true);

  const closeResponse = await request('/api/v1/webhook', jsonOptions(webhookPayload(apiKey.secret_key, {
    signal_id: 'integration-close-1',
    action: 'CLOSE',
    lot: undefined,
    stop_loss: null,
    take_profit: null,
  })));
  assert.equal(closeResponse.status, 202);
  const closeCommand = await (await nextCommand(account, account.bridge_key)).json();
  assert.equal(closeCommand.action, 'CLOSE');
  const closeAck = await sendResult(account, account.bridge_key, closeCommand, {
    order: '50002', deal: '60002', executed_lot: 0.1, profit_loss: 50,
  });
  assert.equal(closeAck.status, 200);
  const closeAckBody = await closeAck.json();
  assert.equal(closeAckBody.performance_fee_deducted, 10);

  const tradeLogs = await (await request('/api/v1/trade-logs?limit=100', { headers: sessionHeaders })).json();
  assert.equal(tradeLogs.trade_logs.length, 2);
  const closeLog = tradeLogs.trade_logs.find((row) => row.action === 'CLOSE');
  assert.equal(closeLog.profit_loss, 50);
  assert.equal(closeLog.performance_fee_deducted, 10);
  const wallet = await pool.query('SELECT wallet_balance FROM users WHERE id = $1', [registeredUser.id]);
  assert.equal(Number(wallet.rows[0].wallet_balance), 90);
  const feeLedger = await pool.query(
    `SELECT transaction_type, amount_usd, balance_after FROM wallet_transactions
     WHERE user_id = $1 AND transaction_type = 'PERFORMANCE_FEE'`,
    [registeredUser.id],
  );
  assert.equal(feeLedger.rows.length, 1);
  assert.equal(Number(feeLedger.rows[0].amount_usd), -10);
  assert.equal(Number(feeLedger.rows[0].balance_after), 90);
  assert.ok(harness.logs.some((entry) => entry.event === 'mt5_execution_confirmed'));
  const logout = await request('/api/v1/auth/logout', { method: 'POST', headers: sessionHeaders });
  assert.equal(logout.status, 204);
  assert.equal((await request('/api/v1/me', { headers: sessionHeaders })).status, 401);
});

test('rejects webhook orders for inactive subscriptions and zero wallet balances', async () => {
  const inactive = await provisionUser({ subscriptionStatus: 'CANCELED', walletBalance: 100 });
  const inactiveResponse = await request('/api/v1/webhook', jsonOptions(webhookPayload(inactive.apiKey.secret_key)));
  assert.equal(inactiveResponse.status, 403);
  assert.equal((await inactiveResponse.json()).error, 'subscription_inactive');

  const emptyWallet = await provisionUser({ subscriptionStatus: 'ACTIVE', walletBalance: 0 });
  const walletResponse = await request('/api/v1/webhook', jsonOptions(webhookPayload(emptyWallet.apiKey.secret_key)));
  assert.equal(walletResponse.status, 402);
  assert.equal((await walletResponse.json()).error, 'insufficient_wallet_balance');
});

test('validates API keys dynamically and enforces bot max-lot limits', async () => {
  const scoped = await provisionUser({ maxLotSize: 0.05 });
  const invalidKey = await request('/api/v1/webhook', jsonOptions(webhookPayload(`tvb_${'x'.repeat(43)}`)));
  assert.equal(invalidKey.status, 401);

  const tooLarge = await request('/api/v1/webhook', jsonOptions(webhookPayload(scoped.apiKey.secret_key, {
    signal_id: 'over-bot-limit',
    lot: 0.1,
  })));
  assert.equal(tooLarge.status, 403);
  assert.equal((await tooLarge.json()).error, 'max_lot_exceeded');

  const noSecret = await request('/api/v1/webhook', jsonOptions({ action: 'BUY', symbol: 'EURUSD', lot: 0.1 }));
  assert.equal(noSecret.status, 401);
});

test('routes commands to the owning MT5 account and rotates bridge credentials only when idle', async () => {
  const first = await provisionUser();
  const second = await provisionUser();
  const accepted = await request('/api/v1/webhook', jsonOptions(webhookPayload(first.apiKey.secret_key, {
    signal_id: 'account-isolation-1',
  })));
  assert.equal(accepted.status, 202);

  const otherAccountPoll = await nextCommand(second.account, second.account.bridge_key);
  assert.equal(otherAccountPoll.status, 204);
  const correctPoll = await nextCommand(first.account, first.account.bridge_key);
  assert.equal(correctPoll.status, 200);
  const command = await correctPoll.json();

  const accountService = new Mt5AccountService({ repository, apiKeyPepper, mt5EncryptionKey });
  const busyRotation = await accountService.rotateBridgeCredential(first.user.id, first.account.id);
  assert.equal(busyRotation.kind, 'busy');
  const ack = await sendResult(first.account, first.account.bridge_key, command, {
    order: '70001', deal: '80001', executed_lot: 0.1,
  });
  assert.equal(ack.status, 200);

  const rotated = await accountService.rotateBridgeCredential(first.user.id, first.account.id);
  assert.equal(rotated.kind, 'rotated');
  assert.notEqual(rotated.account.bridge_id, first.account.bridge_id);
  assert.equal((await nextCommand(first.account, first.account.bridge_key)).status, 401);
  assert.equal((await nextCommand(rotated.account, rotated.bridge_key)).status, 204);
});

test('syncs MT5-managed positions into dashboard metrics without exposing other users data', async () => {
  const first = await provisionUser();
  const second = await provisionUser();
  const firstToken = await createSessionForUser(first.user.id);
  const secondToken = await createSessionForUser(second.user.id);

  const snapshot = await request('/api/v1/mt5/positions/sync', jsonOptions({
    positions: [{
      ticket: '12345001', symbol: 'EURUSDm', side: 'BUY', volume: 0.1,
      open_price: 1.08, current_pnl: 12.34, currency: 'USD', magic_number: 26100801,
      opened_at: Math.floor(Date.now() / 1000) - 120,
    }],
  }, bridgeHeaders(first.account, first.account.bridge_key)));
  assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.json()).position_count, 1);

  const firstOverviewResponse = await request('/api/v1/dashboard/overview', {
    headers: { authorization: `Bearer ${firstToken}` },
  });
  assert.equal(firstOverviewResponse.status, 200);
  const firstOverview = await firstOverviewResponse.json();
  assert.equal(firstOverview.metrics.open_positions, 1);
  assert.equal(firstOverview.metrics.active_pnl_by_currency.USD, 12.34);
  assert.equal(firstOverview.positions[0].ticket, '12345001');

  const secondOverview = await (await request('/api/v1/dashboard/overview', {
    headers: { authorization: `Bearer ${secondToken}` },
  })).json();
  assert.equal(secondOverview.metrics.open_positions, 0);
  assert.deepEqual(secondOverview.positions, []);

  const emptySnapshot = await request('/api/v1/mt5/positions/sync', jsonOptions({ positions: [] }, bridgeHeaders(first.account, first.account.bridge_key)));
  assert.equal(emptySnapshot.status, 200);
  const refreshed = await (await request('/api/v1/dashboard/overview', {
    headers: { authorization: `Bearer ${firstToken}` },
  })).json();
  assert.equal(refreshed.metrics.open_positions, 0);
});

test('panic switch pauses all account bots, prioritizes a close command, and records no synthetic fill', async () => {
  const fixture = await provisionUser();
  const sessionToken = await createSessionForUser(fixture.user.id);
  const sessionHeaders = { authorization: `Bearer ${sessionToken}` };

  const queued = await request('/api/v1/webhook', jsonOptions(webhookPayload(fixture.apiKey.secret_key, {
    signal_id: 'cancel-before-panic',
  })));
  assert.equal(queued.status, 202);

  const panicResponse = await request(`/api/v1/bots/${fixture.bot.id}/panic`, jsonOptions({}, sessionHeaders));
  assert.equal(panicResponse.status, 202);
  const panic = await panicResponse.json();
  assert.equal(panic.status, 'QUEUED');
  const prematureResume = await request(`/api/v1/bots/${fixture.bot.id}`, {
    method: 'PATCH',
    headers: { ...sessionHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ is_active: true }),
  });
  assert.equal(prematureResume.status, 409);
  assert.equal((await prematureResume.json()).error, 'panic_pending');

  const poll = await nextCommand(fixture.account, fixture.account.bridge_key);
  assert.equal(poll.status, 200);
  const command = await poll.json();
  assert.equal(command.action, 'PANIC');
  assert.equal(command.symbol, '*');

  const botRow = await pool.query('SELECT is_active FROM bots_config WHERE id = $1', [fixture.bot.id]);
  assert.equal(botRow.rows[0].is_active, false);
  const cancelled = await pool.query(
    "SELECT status FROM execution_commands WHERE idempotency_key = 'cancel-before-panic'",
  );
  assert.equal(cancelled.rows[0].status, 'FAILED');

  const ack = await sendResult(fixture.account, fixture.account.bridge_key, command, {
    order: '0', deal: '0', executed_lot: 0, profit_loss: 0,
  });
  assert.equal(ack.status, 200);
  assert.equal((await ack.json()).trade_logged, false);
  const logCount = await pool.query('SELECT COUNT(*)::int AS count FROM trade_logs WHERE user_id = $1', [fixture.user.id]);
  assert.equal(logCount.rows[0].count, 0);
});
