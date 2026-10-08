import { randomUUID } from 'node:crypto';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function toPublicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    account_number: row.account_number,
    broker_server: row.broker_server,
    bridge_id: row.bridge_id,
    connection_status: row.connection_status,
    is_active: row.is_active,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
  };
}

function toPublicBot(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    mt5_account_id: row.mt5_account_id,
    bot_name: row.bot_name,
    max_daily_drawdown: Number(row.max_daily_drawdown),
    max_lot_size: Number(row.max_lot_size),
    news_filter_enabled: row.news_filter_enabled,
    performance_fee_rate: Number(row.performance_fee_rate),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toPublicPosition(row) {
  return {
    ticket: row.ticket,
    mt5_account_id: row.mt5_account_id,
    symbol: row.symbol,
    side: row.side,
    volume: Number(row.volume),
    open_price: Number(row.open_price),
    current_pnl: Number(row.current_pnl),
    pnl_currency: row.pnl_currency,
    magic_number: String(row.magic_number),
    opened_at: row.opened_at,
    synced_at: row.synced_at,
  };
}

function toPublicDeposit(row) {
  if (!row) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    network: row.network,
    pay_currency: row.pay_currency,
    amount_usd: Number(row.amount_usd),
    pay_address: row.pay_address,
    pay_amount: row.pay_amount === null ? null : Number(row.pay_amount),
    amount_received: Number(row.amount_received || 0),
    tx_hash: row.tx_hash,
    status: row.status,
    expires_at: row.expires_at,
    credited_at: row.credited_at,
    created_at: row.created_at,
  };
}

function toPublicWalletTransaction(row) {
  return {
    id: row.id,
    transaction_type: row.transaction_type,
    amount_usd: Number(row.amount_usd),
    balance_after: Number(row.balance_after),
    reference_type: row.reference_type,
    reference_id: row.reference_id,
    description: row.description,
    created_at: row.created_at,
  };
}

export class PostgresRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(new PostgresTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async ping() {
    await this.pool.query('SELECT 1');
    return true;
  }

  async bridgeReadiness(staleMs) {
    const cutoff = new Date(Date.now() - staleMs);
    await this.pool.query(
      `UPDATE mt5_accounts SET connection_status = 'DISCONNECTED', updated_at = now()
       WHERE connection_status = 'CONNECTED' AND (last_seen_at IS NULL OR last_seen_at < $1)`,
      [cutoff],
    );
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM mt5_accounts
       WHERE is_active = TRUE AND connection_status = 'CONNECTED' AND last_seen_at >= $1`,
      [cutoff],
    );
    return Number(result.rows[0]?.count || 0);
  }

  async createUser({ email, passwordHash }) {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, email, password_hash, subscription_tier, wallet_balance, created_at`,
      [id, email, passwordHash],
    );
    return result.rows[0];
  }

  async findUserByEmail(email) {
    const result = await this.pool.query(
      `SELECT id, email, password_hash, subscription_tier, wallet_balance, created_at
       FROM users WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async findUserById(id) {
    const result = await this.pool.query(
      `SELECT id, email, subscription_tier, wallet_balance, created_at
       FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async createSession({ userId, tokenHash, expiresAt }) {
    const result = await this.pool.query(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id, expires_at`,
      [randomUUID(), userId, tokenHash, expiresAt],
    );
    return result.rows[0];
  }

  async findUserBySessionTokenHash(tokenHash) {
    const result = await this.pool.query(
      `UPDATE user_sessions SET last_used_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [tokenHash],
    );
    if (!result.rows[0]) return null;
    return this.findUserById(result.rows[0].user_id);
  }

  async revokeSession(tokenHash) {
    const result = await this.pool.query(
      `UPDATE user_sessions SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id`,
      [tokenHash],
    );
    return result.rowCount > 0;
  }

  async createApiKey({ id, userId, botId, secretKeyHash, keyPrefix, label }) {
    const result = await this.pool.query(
      `INSERT INTO api_keys (id, user_id, bot_id, secret_key_hash, key_prefix, label)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, bot_id, key_prefix, label, is_active, created_at, last_used_at`,
      [id, userId, botId, secretKeyHash, keyPrefix, label],
    );
    return result.rows[0];
  }

  async listApiKeys(userId) {
    const result = await this.pool.query(
      `SELECT id, user_id, bot_id, key_prefix, label, is_active, created_at, last_used_at
       FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async revokeApiKey(userId, keyId) {
    const result = await this.pool.query(
      `UPDATE api_keys SET is_active = FALSE
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE
       RETURNING id, is_active`,
      [keyId, userId],
    );
    return result.rows[0] ?? null;
  }

  async createMt5Account({ id, userId, accountNumber, brokerServer, investorPasswordEncrypted, bridgeId, bridgeKeyHash }) {
    const result = await this.pool.query(
      `INSERT INTO mt5_accounts
         (id, user_id, account_number, broker_server, investor_password_encrypted, bridge_id, bridge_key_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, account_number, broker_server, bridge_id, connection_status, is_active, last_seen_at, created_at`,
      [id, userId, accountNumber, brokerServer, investorPasswordEncrypted, bridgeId, bridgeKeyHash],
    );
    return toPublicAccount(result.rows[0]);
  }

  async listMt5Accounts(userId) {
    const result = await this.pool.query(
      `SELECT id, user_id, account_number, broker_server, bridge_id, connection_status,
              is_active, last_seen_at, created_at
       FROM mt5_accounts WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(toPublicAccount);
  }

  async rotateMt5BridgeCredential(userId, accountId, credential) {
    return this.transaction(async (tx) => tx.rotateMt5BridgeCredential(userId, accountId, credential));
  }

  async deactivateMt5Account(userId, accountId) {
    return this.transaction(async (tx) => tx.deactivateMt5Account(userId, accountId));
  }

  async activateMt5Account(userId, accountId, credential) {
    return this.transaction(async (tx) => tx.activateMt5Account(userId, accountId, credential));
  }

  async panicBot(userId, botId) {
    return this.transaction(async (tx) => tx.panicBot(userId, botId));
  }

  async syncMt5Positions(accountId, userId, positions) {
    return this.transaction(async (tx) => tx.syncMt5Positions(accountId, userId, positions));
  }

  async createBotConfig(bot) {
    const result = await this.pool.query(
      `INSERT INTO bots_config
         (id, user_id, mt5_account_id, bot_name, max_daily_drawdown, max_lot_size,
          news_filter_enabled, performance_fee_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, user_id, mt5_account_id, bot_name, max_daily_drawdown, max_lot_size,
                 news_filter_enabled, performance_fee_rate, is_active, created_at, updated_at`,
      [bot.id, bot.userId, bot.mt5AccountId, bot.botName, bot.maxDailyDrawdown, bot.maxLotSize,
        bot.newsFilterEnabled, bot.performanceFeeRate],
    );
    return toPublicBot(result.rows[0]);
  }

  async listBotConfigs(userId) {
    const result = await this.pool.query(
      `SELECT id, user_id, mt5_account_id, bot_name, max_daily_drawdown, max_lot_size,
              news_filter_enabled, performance_fee_rate, is_active, created_at, updated_at
       FROM bots_config WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(toPublicBot);
  }

  async updateBotConfig(userId, botId, patch) {
    return this.transaction(async (tx) => tx.updateBotConfig(userId, botId, patch));
  }

  async listSubscriptions(userId) {
    const result = await this.pool.query(
      `SELECT id, user_id, tier, status, starts_at, ends_at, provider, created_at, updated_at
       FROM subscriptions WHERE user_id = $1 ORDER BY starts_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async listTradeLogs(userId, { limit = 50, offset = 0 } = {}) {
    const result = await this.pool.query(
      `SELECT id, user_id, bot_id, command_id, symbol, action, lot, profit_loss,
              profit_loss_currency, performance_fee_deducted, execution_price,
              broker_order_id, broker_deal_id, broker_retcode, created_at
       FROM trade_logs WHERE user_id = $1 ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return result.rows.map((row) => ({
      ...row,
      lot: Number(row.lot),
      profit_loss: Number(row.profit_loss),
      performance_fee_deducted: Number(row.performance_fee_deducted),
      execution_price: row.execution_price === null ? null : Number(row.execution_price),
    }));
  }

  async listOpenPositions(userId) {
    const result = await this.pool.query(
      `SELECT p.ticket, p.mt5_account_id, p.symbol, p.side, p.volume, p.open_price,
              p.current_pnl, p.pnl_currency, p.magic_number, p.opened_at, p.synced_at
       FROM mt5_positions p
       JOIN mt5_accounts a ON a.id = p.mt5_account_id AND a.user_id = p.user_id
       WHERE p.user_id = $1 AND a.is_active = TRUE
       ORDER BY p.opened_at DESC, p.ticket`,
      [userId],
    );
    return result.rows.map(toPublicPosition);
  }

  async getDashboardOverview(userId) {
    const [userResult, subscriptionResult, accounts, bots, positions, tradeTotals, realizedRows, recentTradeLogs] = await Promise.all([
      this.pool.query(
        `SELECT id, email, subscription_tier, wallet_balance, created_at
         FROM users WHERE id = $1`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, tier, status, starts_at, ends_at, provider, created_at
         FROM subscriptions WHERE user_id = $1
           AND status IN ('TRIAL', 'ACTIVE') AND starts_at <= now()
           AND (ends_at IS NULL OR ends_at > now())
         ORDER BY starts_at DESC LIMIT 1`,
        [userId],
      ),
      this.listMt5Accounts(userId),
      this.listBotConfigs(userId),
      this.listOpenPositions(userId),
      this.pool.query(
        `SELECT COUNT(*)::int AS total_trades_executed,
                COUNT(*) FILTER (WHERE profit_loss > 0)::int AS winning_trades,
                COUNT(*) FILTER (WHERE profit_loss < 0)::int AS losing_trades
         FROM trade_logs WHERE user_id = $1`,
        [userId],
      ),
      this.pool.query(
        `SELECT profit_loss_currency AS currency, COALESCE(SUM(profit_loss), 0) AS pnl
         FROM trade_logs WHERE user_id = $1 GROUP BY profit_loss_currency ORDER BY profit_loss_currency`,
        [userId],
      ),
      this.listTradeLogs(userId, { limit: 8, offset: 0 }),
    ]);

    const user = userResult.rows[0];
    if (!user) return null;
    const activePnlByCurrency = {};
    for (const position of positions) {
      activePnlByCurrency[position.pnl_currency] = (activePnlByCurrency[position.pnl_currency] || 0) + position.current_pnl;
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        subscription_tier: user.subscription_tier,
        wallet_balance: Number(user.wallet_balance),
        created_at: user.created_at,
      },
      subscription: subscriptionResult.rows[0] ?? null,
      accounts,
      bots,
      positions,
      metrics: {
        total_trades_executed: Number(tradeTotals.rows[0]?.total_trades_executed || 0),
        winning_trades: Number(tradeTotals.rows[0]?.winning_trades || 0),
        losing_trades: Number(tradeTotals.rows[0]?.losing_trades || 0),
        open_positions: positions.length,
        active_pnl_by_currency: activePnlByCurrency,
        realized_pnl_by_currency: Object.fromEntries(realizedRows.rows.map((row) => [row.currency, Number(row.pnl)])),
      },
      recent_trade_logs: recentTradeLogs,
    };
  }

  async getBillingOverview(userId) {
    const [userResult, subscriptionResult, depositsResult, walletTransactionsResult, telegramResult] = await Promise.all([
      this.pool.query('SELECT wallet_balance, subscription_tier FROM users WHERE id = $1', [userId]),
      this.pool.query(
        `SELECT id, tier, status, starts_at, ends_at, provider, monthly_price_usd, created_at
         FROM subscriptions WHERE user_id = $1 ORDER BY starts_at DESC, created_at DESC LIMIT 1`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, order_id, network, pay_currency, amount_usd, pay_address, pay_amount,
                amount_received, tx_hash, status, expires_at, credited_at, created_at
         FROM payment_deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [userId],
      ),
      this.pool.query(
        `SELECT id, transaction_type, amount_usd, balance_after, reference_type, reference_id,
                description, created_at
         FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 30`,
        [userId],
      ),
      this.pool.query(
        `SELECT is_active, connected_at FROM telegram_links WHERE user_id = $1`,
        [userId],
      ),
    ]);
    const user = userResult.rows[0];
    if (!user) return null;
    return {
      wallet_balance: Number(user.wallet_balance),
      subscription_tier: user.subscription_tier,
      subscription: subscriptionResult.rows[0] ? {
        ...subscriptionResult.rows[0],
        monthly_price_usd: Number(subscriptionResult.rows[0].monthly_price_usd),
      } : null,
      deposits: depositsResult.rows.map(toPublicDeposit),
      wallet_transactions: walletTransactionsResult.rows.map(toPublicWalletTransaction),
      telegram_linked: Boolean(telegramResult.rows[0]?.is_active),
      telegram_connected_at: telegramResult.rows[0]?.connected_at ?? null,
    };
  }

  async createPendingDeposit({ id, userId, orderId, network, payCurrency, amountUsd }) {
    const result = await this.pool.query(
      `INSERT INTO payment_deposits (id, user_id, order_id, network, pay_currency, amount_usd)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, order_id, network, pay_currency, amount_usd, status, created_at`,
      [id, userId, orderId, network, payCurrency, amountUsd],
    );
    return toPublicDeposit(result.rows[0]);
  }

  async attachProviderPayment(depositId, quote) {
    const result = await this.pool.query(
      `UPDATE payment_deposits
       SET provider_payment_id = COALESCE(provider_payment_id, $2), pay_address = COALESCE(pay_address, $3),
           pay_amount = COALESCE(pay_amount, $4),
           status = CASE WHEN status = 'CREATING' THEN $5 ELSE status END,
           expires_at = COALESCE(expires_at, $6), updated_at = now()
       WHERE id = $1 AND (provider_payment_id IS NULL OR provider_payment_id = $2)
       RETURNING id, order_id, network, pay_currency, amount_usd, pay_address, pay_amount,
                 amount_received, tx_hash, status, expires_at, credited_at, created_at`,
      [depositId, quote.providerPaymentId, quote.payAddress, quote.payAmount,
        quote.status || 'WAITING', quote.expiresAt],
    );
    if (!result.rows[0]) throw new Error('Pending deposit disappeared before provider details were saved');
    return toPublicDeposit(result.rows[0]);
  }

  async failPendingDeposit(depositId) {
    await this.pool.query(
      `UPDATE payment_deposits SET status = 'FAILED', updated_at = now()
       WHERE id = $1 AND status = 'CREATING'`,
      [depositId],
    );
  }

  async getPaymentDeposit(userId, depositId) {
    const result = await this.pool.query(
      `SELECT id, order_id, network, pay_currency, amount_usd, pay_address, pay_amount,
              amount_received, tx_hash, status, expires_at, credited_at, created_at
       FROM payment_deposits WHERE id = $1 AND user_id = $2`,
      [depositId, userId],
    );
    return toPublicDeposit(result.rows[0]);
  }

  async applyPaymentWebhook(input) {
    return this.transaction(async (tx) => tx.applyPaymentWebhook(input));
  }

  async upgradeSubscription(input) {
    return this.transaction(async (tx) => tx.upgradeSubscription(input));
  }

  async renewDueSubscriptions(input) {
    return this.transaction(async (tx) => tx.renewDueSubscriptions(input));
  }

  async createTelegramConnectCode(input) {
    return this.transaction(async (tx) => tx.createTelegramConnectCode(input));
  }

  async connectTelegram(input) {
    return this.transaction(async (tx) => tx.connectTelegram(input));
  }

  async disconnectTelegram(input) {
    return this.transaction(async (tx) => tx.disconnectTelegram(input));
  }

  async unlinkTelegram(userId) {
    const result = await this.pool.query('DELETE FROM telegram_links WHERE user_id = $1 RETURNING user_id', [userId]);
    return result.rowCount > 0;
  }

  async enqueueNotification(input) {
    return this.transaction(async (tx) => tx.enqueueNotification(input));
  }

  async claimNotificationBatch(input) {
    return this.transaction(async (tx) => tx.claimNotificationBatch(input));
  }

  async completeNotification(id) {
    await this.pool.query(
      `UPDATE notification_outbox SET status = 'SENT', sent_at = now(), lease_until = NULL, last_error = NULL
       WHERE id = $1 AND status = 'SENDING'`,
      [id],
    );
  }

  async skipNotification(id) {
    await this.pool.query(
      `UPDATE notification_outbox SET status = 'SKIPPED', lease_until = NULL
       WHERE id = $1 AND status = 'SENDING'`,
      [id],
    );
  }

  async retryNotification(id, error, { maxAttempts, retryDelayMs }) {
    await this.pool.query(
      `UPDATE notification_outbox
       SET status = CASE WHEN attempt_count >= $2 THEN 'FAILED' ELSE 'QUEUED' END,
           available_at = now() + ($3::double precision * interval '1 millisecond'),
           lease_until = NULL, last_error = $4
       WHERE id = $1 AND status = 'SENDING'`,
      [id, maxAttempts, retryDelayMs, String(error).slice(0, 255)],
    );
  }

  async authenticateBridge(bridgeId, bridgeKeyHash) {
    const result = await this.pool.query(
      `UPDATE mt5_accounts
       SET last_seen_at = now(), connection_status = 'CONNECTED', updated_at = now()
       WHERE bridge_id = $1 AND bridge_key_hash = $2 AND is_active = TRUE
       RETURNING id, user_id, bridge_id`,
      [bridgeId, bridgeKeyHash],
    );
    return result.rows[0] ?? null;
  }

  async claimNext(accountId, bridgeId, leaseMs, minWalletBalanceUsd = 0) {
    return this.transaction(async (tx) => tx.claimNext(accountId, bridgeId, leaseMs, minWalletBalanceUsd));
  }

  async completeCommand(commandId, leaseToken, accountId, result, minWalletBalanceUsd = 0) {
    return this.transaction(async (tx) => tx.completeCommand(commandId, leaseToken, accountId, result, minWalletBalanceUsd));
  }
}

class PostgresTransaction {
  constructor(client) {
    this.client = client;
  }

  async enqueueNotification({ userId, eventType, payload = {}, idempotencyKey }) {
    const result = await this.client.query(
      `INSERT INTO notification_outbox (id, user_id, event_type, payload, idempotency_key)
       VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [randomUUID(), userId, eventType, JSON.stringify(payload), idempotencyKey],
    );
    return result.rowCount > 0;
  }

  async enforceWalletMinimum(userId, minimumUsd) {
    if (!Number.isFinite(Number(minimumUsd)) || Number(minimumUsd) <= 0) return false;
    const userResult = await this.client.query(
      `SELECT wallet_balance, low_wallet_alerted_at FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) return false;
    const balance = Number(user.wallet_balance);
    if (balance >= Number(minimumUsd)) {
      if (user.low_wallet_alerted_at) {
        await this.client.query('UPDATE users SET low_wallet_alerted_at = NULL WHERE id = $1', [userId]);
      }
      return false;
    }

    await this.client.query(
      `UPDATE bots_config SET is_active = FALSE, updated_at = now()
       WHERE user_id = $1 AND is_active = TRUE`,
      [userId],
    );
    await this.client.query(
      `UPDATE execution_commands
       SET status = 'FAILED', result_json = $2::jsonb, claimed_by = NULL, lease_token = NULL,
           lease_until = NULL, updated_at = now()
       WHERE user_id = $1 AND status = 'QUEUED' AND action IN ('BUY', 'SELL')`,
      [userId, JSON.stringify({ success: false, message: 'Wallet is below the configured trading minimum' })],
    );
    if (!user.low_wallet_alerted_at) {
      await this.client.query('UPDATE users SET low_wallet_alerted_at = now() WHERE id = $1', [userId]);
      await this.enqueueNotification({
        userId,
        eventType: 'LOW_WALLET_BALANCE',
        payload: { balance_usd: balance, minimum_usd: Number(minimumUsd) },
        idempotencyKey: `wallet-low:${userId}:${randomUUID()}`,
      });
    }
    return true;
  }

  async pauseUserForBilling(userId, reason) {
    await this.client.query(
      `UPDATE bots_config SET is_active = FALSE, updated_at = now()
       WHERE user_id = $1 AND is_active = TRUE`,
      [userId],
    );
    await this.client.query(
      `UPDATE execution_commands
       SET status = 'FAILED', result_json = $2::jsonb, claimed_by = NULL, lease_token = NULL,
           lease_until = NULL, updated_at = now()
       WHERE user_id = $1 AND status = 'QUEUED' AND action IN ('BUY', 'SELL')`,
      [userId, JSON.stringify({ success: false, message: reason })],
    );
  }

  async triggerDailyDrawdown({ userId, botId, botName, drawdownUsd, limitUsd }) {
    await this.client.query(
      `UPDATE bots_config SET is_active = FALSE, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
      [botId, userId],
    );
    await this.client.query(
      `UPDATE execution_commands
       SET status = 'FAILED', result_json = $2::jsonb, claimed_by = NULL, lease_token = NULL,
           lease_until = NULL, updated_at = now()
       WHERE bot_id = $1 AND status = 'QUEUED' AND action IN ('BUY', 'SELL')`,
      [botId, JSON.stringify({ success: false, message: 'Bot paused by its daily drawdown guard' })],
    );
    const date = new Date().toISOString().slice(0, 10);
    await this.enqueueNotification({
      userId,
      eventType: 'DAILY_DRAWDOWN',
      payload: { bot_name: botName, drawdown_usd: drawdownUsd, limit_usd: limitUsd },
      idempotencyKey: `drawdown:${botId}:${date}`,
    });
  }

  async createPendingDeposit({ id, userId, orderId, network, payCurrency, amountUsd }) {
    const result = await this.client.query(
      `INSERT INTO payment_deposits (id, user_id, order_id, network, pay_currency, amount_usd)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, userId, orderId, network, payCurrency, amountUsd],
    );
    return result.rows[0];
  }

  async applyPaymentWebhook(input) {
    const eventResult = await this.client.query(
      `INSERT INTO payment_webhook_events
         (id, provider, event_key, provider_payment_id, provider_status)
       VALUES ($1,'nowpayments',$2,$3,$4)
       ON CONFLICT (event_key) DO NOTHING RETURNING id`,
      [randomUUID(), input.eventKey, input.providerPaymentId, input.providerStatus],
    );
    if (!eventResult.rows[0]) return { kind: 'duplicate' };

    const depositResult = await this.client.query(
      `SELECT id, user_id, provider_payment_id, network, pay_currency, price_currency,
              amount_usd, pay_amount, amount_received, status, credited_at
       FROM payment_deposits
       WHERE order_id = $1
       LIMIT 1 FOR UPDATE`,
      [input.orderId],
    );
    const deposit = depositResult.rows[0];
    if (!deposit) return { kind: 'not_found' };
    if ((deposit.provider_payment_id && deposit.provider_payment_id !== input.providerPaymentId)
      || deposit.pay_currency.toLowerCase() !== input.payCurrency
      || deposit.price_currency !== input.priceCurrency
      || Math.abs(Number(deposit.amount_usd) - input.priceAmount) > 0.005) {
      return { kind: 'payment_mismatch' };
    }
    await this.client.query(
      `UPDATE payment_webhook_events SET deposit_id = $2 WHERE id = $1`,
      [eventResult.rows[0].id, deposit.id],
    );
    if (deposit.credited_at) return { kind: 'already_credited', depositId: deposit.id };

    const status = input.providerStatus;
    if (status === 'FINISHED' && input.receivedAmount <= 0) return { kind: 'payment_mismatch' };
    await this.client.query(
      `UPDATE payment_deposits
       SET provider_payment_id = COALESCE(provider_payment_id, $2), status = $3,
           amount_received = GREATEST(amount_received, $4), tx_hash = COALESCE($5, tx_hash), updated_at = now()
       WHERE id = $1`,
      [deposit.id, input.providerPaymentId, status, input.receivedAmount, input.txHash],
    );
    if (status !== 'FINISHED') return { kind: 'updated', status, depositId: deposit.id };

    const userResult = await this.client.query(
      `SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE`,
      [deposit.user_id],
    );
    if (!userResult.rows[0]) return { kind: 'not_found' };
    const credit = Number(deposit.amount_usd);
    const walletResult = await this.client.query(
      `UPDATE users SET wallet_balance = wallet_balance + $2, updated_at = now()
       WHERE id = $1 RETURNING wallet_balance`,
      [deposit.user_id, credit],
    );
    const balanceAfter = Number(walletResult.rows[0].wallet_balance);
    await this.client.query(
      `INSERT INTO wallet_transactions
         (id,user_id,transaction_type,amount_usd,balance_after,reference_type,reference_id,
          idempotency_key,description,metadata)
       VALUES ($1,$2,'TOP_UP',$3,$4,'payment_deposit',$5,$6,$7,$8::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [randomUUID(), deposit.user_id, credit, balanceAfter, deposit.id, `deposit:${deposit.id}`,
        `USDT ${deposit.network} wallet top-up`, JSON.stringify({ provider: 'nowpayments', provider_payment_id: input.providerPaymentId, tx_hash: input.txHash })],
    );
    await this.client.query(
      `UPDATE payment_deposits SET status = 'FINISHED', credited_at = now(), updated_at = now()
       WHERE id = $1 AND credited_at IS NULL`,
      [deposit.id],
    );
    if (balanceAfter >= Number(input.minWalletBalanceUsd)) {
      await this.client.query('UPDATE users SET low_wallet_alerted_at = NULL WHERE id = $1', [deposit.user_id]);
    }
    await this.enqueueNotification({
      userId: deposit.user_id,
      eventType: 'WALLET_TOP_UP',
      payload: { amount_usd: credit, network: deposit.network, tx_hash: input.txHash },
      idempotencyKey: `deposit-credited:${deposit.id}`,
    });
    return { kind: 'credited', depositId: deposit.id, creditedUsd: credit, walletBalance: balanceAfter };
  }

  async upgradeSubscription({ userId, tier, monthlyPriceUsd, minWalletBalanceUsd }) {
    const userResult = await this.client.query(
      `SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) return { kind: 'not_found' };
    const currentResult = await this.client.query(
      `SELECT id, tier, status, ends_at FROM subscriptions
       WHERE user_id = $1 AND status IN ('ACTIVE','TRIAL') AND starts_at <= now()
         AND (ends_at IS NULL OR ends_at > now())
       ORDER BY starts_at DESC LIMIT 1 FOR UPDATE`,
      [userId],
    );
    const current = currentResult.rows[0];
    if (current?.tier === tier) return { kind: 'already_active' };
    const balance = Number(user.wallet_balance);
    if (balance < monthlyPriceUsd) return { kind: 'insufficient_balance', balance, required: monthlyPriceUsd };

    const now = new Date();
    await this.client.query(
      `UPDATE subscriptions SET status = 'CANCELED', ends_at = $2, updated_at = now()
       WHERE user_id = $1 AND status IN ('ACTIVE','TRIAL')`,
      [userId, now],
    );
    const updatedUser = await this.client.query(
      `UPDATE users SET wallet_balance = wallet_balance - $2, subscription_tier = $3, updated_at = now()
       WHERE id = $1 RETURNING wallet_balance`,
      [userId, monthlyPriceUsd, tier],
    );
    const balanceAfter = Number(updatedUser.rows[0].wallet_balance);
    const subscriptionId = randomUUID();
    const subscriptionResult = await this.client.query(
      `INSERT INTO subscriptions
         (id,user_id,tier,status,starts_at,ends_at,provider,provider_subscription_id,monthly_price_usd)
       VALUES ($1,$2,$3,'ACTIVE',now(),now() + interval '1 month','wallet',NULL,$4)
       RETURNING id,user_id,tier,status,starts_at,ends_at,provider,monthly_price_usd,created_at`,
      [subscriptionId, userId, tier, monthlyPriceUsd],
    );
    await this.client.query(
      `INSERT INTO wallet_transactions
         (id,user_id,transaction_type,amount_usd,balance_after,reference_type,reference_id,
          idempotency_key,description,metadata)
       VALUES ($1,$2,'SUBSCRIPTION_CHARGE',$3,$4,'subscription',$5,$6,$7,$8::jsonb)`,
      [randomUUID(), userId, -monthlyPriceUsd, balanceAfter, subscriptionId,
        `subscription-charge:${subscriptionId}`, `${tier} monthly subscription`, JSON.stringify({ tier, monthly_price_usd: monthlyPriceUsd })],
    );
    await this.enqueueNotification({
      userId,
      eventType: 'SUBSCRIPTION_RENEWED',
      payload: { tier, amount_usd: monthlyPriceUsd, balance_usd: balanceAfter },
      idempotencyKey: `subscription-started:${subscriptionId}`,
    });
    await this.enforceWalletMinimum(userId, minWalletBalanceUsd);
    return { kind: 'upgraded', subscription: subscriptionResult.rows[0], wallet_balance: balanceAfter };
  }

  async renewDueSubscriptions({ subscriptionPricesUsd, minWalletBalanceUsd }) {
    const dueUsers = await this.client.query(
      `SELECT u.id FROM users u
       WHERE EXISTS (
         SELECT 1 FROM subscriptions s
         WHERE s.user_id = u.id AND s.status = 'ACTIVE'
           AND s.ends_at IS NOT NULL AND s.ends_at <= now()
       )
       ORDER BY (SELECT MIN(s.ends_at) FROM subscriptions s
                 WHERE s.user_id = u.id AND s.status = 'ACTIVE' AND s.ends_at <= now()), u.id
       FOR UPDATE OF u SKIP LOCKED LIMIT 50`,
    );
    const results = [];
    for (const { id: userId } of dueUsers.rows) {
      const due = await this.client.query(
        `SELECT id,user_id,tier,monthly_price_usd,ends_at FROM subscriptions
         WHERE user_id = $1 AND status = 'ACTIVE' AND ends_at IS NOT NULL AND ends_at <= now()
         ORDER BY ends_at LIMIT 1 FOR UPDATE`,
        [userId],
      );
      const subscription = due.rows[0];
      if (!subscription) continue;
      const userResult = await this.client.query(
        `SELECT wallet_balance FROM users WHERE id = $1`,
        [userId],
      );
      if (!userResult.rows[0]) continue;
      const price = Number(subscription.monthly_price_usd) || Number(subscriptionPricesUsd[subscription.tier]);
      const balance = Number(userResult.rows[0].wallet_balance);
      if (balance < price) {
        await this.client.query(
          `UPDATE subscriptions SET status = 'PAST_DUE', updated_at = now() WHERE id = $1`,
          [subscription.id],
        );
        await this.pauseUserForBilling(subscription.user_id, 'Subscription renewal is past due');
        await this.enqueueNotification({
          userId: subscription.user_id,
          eventType: 'SUBSCRIPTION_PAYMENT_FAILED',
          payload: { tier: subscription.tier, amount_usd: price },
          idempotencyKey: `subscription-failed:${subscription.id}`,
        });
        await this.enforceWalletMinimum(subscription.user_id, minWalletBalanceUsd);
        results.push({ id: subscription.id, kind: 'insufficient_balance' });
        continue;
      }

      await this.client.query(
        `UPDATE subscriptions SET status = 'EXPIRED', updated_at = now() WHERE id = $1`,
        [subscription.id],
      );
      const walletResult = await this.client.query(
        `UPDATE users SET wallet_balance = wallet_balance - $2, subscription_tier = $3, updated_at = now()
         WHERE id = $1 RETURNING wallet_balance`,
        [subscription.user_id, price, subscription.tier],
      );
      const balanceAfter = Number(walletResult.rows[0].wallet_balance);
      const nextId = randomUUID();
      await this.client.query(
        `INSERT INTO subscriptions
           (id,user_id,tier,status,starts_at,ends_at,provider,monthly_price_usd)
         VALUES ($1,$2,$3,'ACTIVE',now(),now() + interval '1 month','wallet',$4)`,
        [nextId, subscription.user_id, subscription.tier, price],
      );
      await this.client.query(
        `INSERT INTO wallet_transactions
           (id,user_id,transaction_type,amount_usd,balance_after,reference_type,reference_id,
            idempotency_key,description,metadata)
         VALUES ($1,$2,'SUBSCRIPTION_RENEWAL',$3,$4,'subscription',$5,$6,$7,$8::jsonb)`,
        [randomUUID(), subscription.user_id, -price, balanceAfter, nextId,
          `subscription-renewal:${nextId}`, `${subscription.tier} monthly renewal`, JSON.stringify({ tier: subscription.tier, monthly_price_usd: price })],
      );
      await this.enqueueNotification({
        userId: subscription.user_id,
        eventType: 'SUBSCRIPTION_RENEWED',
        payload: { tier: subscription.tier, amount_usd: price, balance_usd: balanceAfter },
        idempotencyKey: `subscription-renewed:${nextId}`,
      });
      await this.enforceWalletMinimum(subscription.user_id, minWalletBalanceUsd);
      results.push({ id: subscription.id, kind: 'renewed', next_subscription_id: nextId });
    }
    return results;
  }

  async createTelegramConnectCode({ userId, tokenHash, expiresAt }) {
    await this.client.query(
      `UPDATE telegram_connect_codes SET used_at = now()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    const result = await this.client.query(
      `INSERT INTO telegram_connect_codes (id,user_id,token_hash,expires_at)
       VALUES ($1,$2,$3,$4) RETURNING id,expires_at`,
      [randomUUID(), userId, tokenHash, expiresAt],
    );
    return result.rows[0];
  }

  async connectTelegram({ updateId, tokenHash, chatId }) {
    const seen = await this.client.query(
      `INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id`,
      [updateId],
    );
    if (!seen.rows[0]) return { kind: 'duplicate' };
    const codeResult = await this.client.query(
      `SELECT id,user_id FROM telegram_connect_codes
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [tokenHash],
    );
    const code = codeResult.rows[0];
    if (!code) return { kind: 'invalid_code' };
    const currentChat = await this.client.query(
      `SELECT user_id FROM telegram_links WHERE chat_id = $1 FOR UPDATE`,
      [chatId],
    );
    if (currentChat.rows[0] && currentChat.rows[0].user_id !== code.user_id) return { kind: 'chat_in_use' };
    await this.client.query(
      `INSERT INTO telegram_links (user_id,chat_id,is_active)
       VALUES ($1,$2,TRUE)
       ON CONFLICT (user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, is_active = TRUE, updated_at = now()`,
      [code.user_id, chatId],
    );
    await this.client.query('UPDATE telegram_connect_codes SET used_at = now() WHERE id = $1', [code.id]);
    await this.enqueueNotification({
      userId: code.user_id,
      eventType: 'TELEGRAM_CONNECTED',
      payload: {},
      idempotencyKey: `telegram-connected:${updateId}`,
    });
    return { kind: 'connected' };
  }

  async disconnectTelegram({ updateId, chatId }) {
    const seen = await this.client.query(
      `INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id`,
      [updateId],
    );
    if (!seen.rows[0]) return { kind: 'duplicate' };
    const result = await this.client.query(
      `DELETE FROM telegram_links WHERE chat_id = $1 RETURNING user_id`,
      [chatId],
    );
    return result.rows[0] ? { kind: 'disconnected' } : { kind: 'not_linked' };
  }

  async claimNotificationBatch({ limit = 10, maxAttempts = 8 }) {
    await this.client.query(
      `UPDATE notification_outbox SET status = 'QUEUED', lease_until = NULL
       WHERE status = 'SENDING' AND lease_until <= now() AND attempt_count < $1`,
      [maxAttempts],
    );
    const result = await this.client.query(
      `WITH ready AS (
         SELECT id FROM notification_outbox
         WHERE status = 'QUEUED' AND available_at <= now() AND attempt_count < $2
         ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE notification_outbox n
       SET status = 'SENDING', attempt_count = n.attempt_count + 1, lease_until = now() + interval '45 seconds'
       FROM ready r
       WHERE n.id = r.id
       RETURNING n.id,n.user_id,n.event_type,n.payload,n.attempt_count`,
      [limit, maxAttempts],
    );
    if (!result.rows.length) return [];
    const ids = result.rows.map((row) => row.id);
    const links = await this.client.query(
      `SELECT n.id,l.chat_id FROM notification_outbox n
       LEFT JOIN telegram_links l ON l.user_id = n.user_id AND l.is_active = TRUE
       WHERE n.id = ANY($1::uuid[])`,
      [ids],
    );
    const chatByNotification = new Map(links.rows.map((row) => [row.id, row.chat_id]));
    return result.rows.map((row) => ({ ...row, chat_id: chatByNotification.get(row.id) ?? null }));
  }

  async updateBotConfig(userId, botId, patch) {
    const bot = await this.client.query(
      `SELECT id, mt5_account_id FROM bots_config WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [botId, userId],
    );
    if (!bot.rows[0]) return null;
    if (patch.isActive === true) {
      const panic = await this.client.query(
        `SELECT 1 FROM execution_commands
         WHERE mt5_account_id = $1 AND action = 'PANIC' AND status IN ('QUEUED', 'CLAIMED')
         LIMIT 1`,
        [bot.rows[0].mt5_account_id],
      );
      if (panic.rows.length > 0) return { kind: 'panic_pending' };
    }
    const columns = {
      botName: 'bot_name',
      maxDailyDrawdown: 'max_daily_drawdown',
      maxLotSize: 'max_lot_size',
      newsFilterEnabled: 'news_filter_enabled',
      performanceFeeRate: 'performance_fee_rate',
      isActive: 'is_active',
    };
    const entries = Object.entries(patch);
    const assignments = entries.map(([key], index) => `${columns[key]} = $${index + 3}`);
    const values = entries.map(([, value]) => value);
    const result = await this.client.query(
      `UPDATE bots_config SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, mt5_account_id, bot_name, max_daily_drawdown, max_lot_size,
                 news_filter_enabled, performance_fee_rate, is_active, created_at, updated_at`,
      [botId, userId, ...values],
    );
    return result.rows[0] ? toPublicBot(result.rows[0]) : null;
  }

  async syncMt5Positions(accountId, userId, positions) {
    const account = await this.client.query(
      `SELECT id FROM mt5_accounts WHERE id = $1 AND user_id = $2 AND is_active = TRUE FOR UPDATE`,
      [accountId, userId],
    );
    if (!account.rows[0]) return { kind: 'not_found' };
    await this.client.query('DELETE FROM mt5_positions WHERE mt5_account_id = $1', [accountId]);
    for (const position of positions) {
      await this.client.query(
        `INSERT INTO mt5_positions
           (user_id, mt5_account_id, ticket, symbol, side, volume, open_price,
            current_pnl, pnl_currency, magic_number, opened_at, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
        [userId, accountId, position.ticket, position.symbol, position.side, position.volume,
          position.openPrice, position.currentPnl, position.currency, position.magicNumber,
          position.openedAt],
      );
    }
    return { kind: 'synced', count: positions.length };
  }

  async panicBot(userId, botId) {
    const botResult = await this.client.query(
      `SELECT b.id AS bot_id, b.mt5_account_id, a.is_active AS account_is_active,
              a.connection_status, a.last_seen_at, a.account_number, a.broker_server
       FROM bots_config b
       JOIN mt5_accounts a ON a.id = b.mt5_account_id AND a.user_id = b.user_id
       WHERE b.id = $1 AND b.user_id = $2
       FOR UPDATE OF b, a`,
      [botId, userId],
    );
    const bot = botResult.rows[0];
    if (!bot) return { kind: 'not_found' };

    await this.client.query(
      `UPDATE bots_config SET is_active = FALSE, updated_at = now()
       WHERE user_id = $1 AND mt5_account_id = $2`,
      [userId, bot.mt5_account_id],
    );
    await this.client.query(
      `UPDATE execution_commands
       SET status = 'FAILED',
           result_json = $2::jsonb,
           claimed_by = NULL, lease_token = NULL, lease_until = NULL, updated_at = now()
       WHERE mt5_account_id = $1 AND status = 'QUEUED' AND action <> 'PANIC'`,
      [bot.mt5_account_id, JSON.stringify({ success: false, message: 'Superseded by emergency panic command' })],
    );
    if (!bot.account_is_active) return { kind: 'account_inactive', accountId: bot.mt5_account_id };

    const existingPanic = await this.client.query(
      `SELECT id, status FROM execution_commands
       WHERE mt5_account_id = $1 AND action = 'PANIC' AND status IN ('QUEUED', 'CLAIMED')
       ORDER BY received_at DESC LIMIT 1`,
      [bot.mt5_account_id],
    );
    if (existingPanic.rows[0]) {
      return {
        kind: 'pending',
        id: existingPanic.rows[0].id,
        status: existingPanic.rows[0].status,
        accountId: bot.mt5_account_id,
        lastSeenAt: bot.last_seen_at,
      };
    }

    const commandId = randomUUID();
    const idempotencyKey = `panic-${randomUUID()}`;
    const payload = {
      signal_id: idempotencyKey,
      action: 'PANIC',
      source_symbol: '*',
      symbol: '*',
      lot: 0,
      bot_id: bot.bot_id,
    };
    await this.client.query(
      `INSERT INTO execution_commands
         (id, user_id, api_key_id, bot_id, mt5_account_id, idempotency_key, action,
          source_symbol, symbol, lot, performance_fee_rate, payload, priority)
       VALUES ($1,$2,NULL,$3,$4,$5,'PANIC','*','*',0,0,$6::jsonb,100)`,
      [commandId, userId, bot.bot_id, bot.mt5_account_id, idempotencyKey, JSON.stringify(payload)],
    );
    await this.client.query("SELECT pg_notify('farhood_execution_commands', $1)", [bot.mt5_account_id]);
    await this.enqueueNotification({
      userId,
      eventType: 'PANIC_ACTIVATED',
      payload: { account_number: bot.account_number, broker_server: bot.broker_server },
      idempotencyKey: `panic-activated:${commandId}`,
    });
    return {
      kind: 'pending',
      id: commandId,
      status: 'QUEUED',
      accountId: bot.mt5_account_id,
      lastSeenAt: bot.last_seen_at,
    };
  }

  async rotateMt5BridgeCredential(userId, accountId, credential) {
    const accountResult = await this.client.query(
      `SELECT id FROM mt5_accounts WHERE id = $1 AND user_id = $2 AND is_active = TRUE FOR UPDATE`,
      [accountId, userId],
    );
    if (!accountResult.rows[0]) return { kind: 'not_found' };
    const claimed = await this.client.query(
      `SELECT 1 FROM execution_commands WHERE mt5_account_id = $1 AND status = 'CLAIMED' LIMIT 1`,
      [accountId],
    );
    if (claimed.rows.length > 0) return { kind: 'busy' };
    const result = await this.client.query(
      `UPDATE mt5_accounts
       SET bridge_id = $3, bridge_key_hash = $4, connection_status = 'DISCONNECTED',
           last_seen_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, account_number, broker_server, bridge_id, connection_status,
                 is_active, last_seen_at, created_at`,
      [accountId, userId, credential.bridgeId, credential.bridgeKeyHash],
    );
    return { kind: 'rotated', account: toPublicAccount(result.rows[0]) };
  }

  async activateMt5Account(userId, accountId, credential) {
    const accountResult = await this.client.query(
      `SELECT id, is_active FROM mt5_accounts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [accountId, userId],
    );
    const current = accountResult.rows[0];
    if (!current) return { kind: 'not_found' };
    if (current.is_active) return { kind: 'already_active' };
    const result = await this.client.query(
      `UPDATE mt5_accounts
       SET is_active = TRUE, bridge_id = $3, bridge_key_hash = $4,
           connection_status = 'DISCONNECTED', last_seen_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, account_number, broker_server, bridge_id, connection_status,
                 is_active, last_seen_at, created_at`,
      [accountId, userId, credential.bridgeId, credential.bridgeKeyHash],
    );
    return { kind: 'activated', account: toPublicAccount(result.rows[0]) };
  }

  async deactivateMt5Account(userId, accountId) {
    const accountResult = await this.client.query(
      `SELECT id FROM mt5_accounts WHERE id = $1 AND user_id = $2 AND is_active = TRUE FOR UPDATE`,
      [accountId, userId],
    );
    if (!accountResult.rows[0]) return { kind: 'not_found' };
    const claimed = await this.client.query(
      `SELECT 1 FROM execution_commands WHERE mt5_account_id = $1 AND status = 'CLAIMED' LIMIT 1`,
      [accountId],
    );
    if (claimed.rows.length > 0) return { kind: 'busy' };
    await this.client.query(
      `UPDATE execution_commands
       SET status = 'FAILED', result_json = $2::jsonb, updated_at = now()
       WHERE mt5_account_id = $1 AND status = 'QUEUED'`,
      [accountId, JSON.stringify({ success: false, message: 'MT5 account deactivated before execution' })],
    );
    await this.client.query('DELETE FROM mt5_positions WHERE mt5_account_id = $1', [accountId]);
    const result = await this.client.query(
      `UPDATE mt5_accounts SET is_active = FALSE, connection_status = 'DISCONNECTED',
              last_seen_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [accountId, userId],
    );
    return result.rows[0] ? { kind: 'deactivated', id: accountId } : { kind: 'not_found' };
  }

  async getWebhookContext(secretHash, requestedBotId) {
    const keyResult = await this.client.query(
      `SELECT k.id AS api_key_id, k.user_id, k.bot_id AS api_key_bot_id,
              u.subscription_tier AS user_subscription_tier, u.wallet_balance
       FROM api_keys k JOIN users u ON u.id = k.user_id
       WHERE k.secret_key_hash = $1 AND k.is_active = TRUE
       FOR UPDATE OF k, u`,
      [secretHash],
    );
    const key = keyResult.rows[0];
    if (!key) return null;
    await this.client.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [key.api_key_id]);

    const subscriptionResult = await this.client.query(
      `SELECT id, tier, status FROM subscriptions
       WHERE user_id = $1 AND status IN ('ACTIVE', 'TRIAL')
         AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
       ORDER BY starts_at DESC LIMIT 1 FOR SHARE`,
      [key.user_id],
    );
    const subscription = subscriptionResult.rows[0] ?? null;
    const subscriptionActive = Boolean(subscription)
      && subscription.tier === key.user_subscription_tier;

    if (key.api_key_bot_id && requestedBotId && key.api_key_bot_id !== requestedBotId) {
      return {
        apiKeyId: key.api_key_id,
        apiKeyBotId: key.api_key_bot_id,
        userId: key.user_id,
        walletBalance: key.wallet_balance,
        subscriptionActive,
        bot: null,
        mt5Account: null,
      };
    }
    const botId = key.api_key_bot_id || requestedBotId || null;
    let botResult;
    if (botId) {
      botResult = await this.client.query(
        `SELECT b.id, b.user_id, b.mt5_account_id, b.bot_name, b.max_daily_drawdown,
                b.max_lot_size, b.news_filter_enabled, b.performance_fee_rate, b.is_active,
                a.is_active AS account_is_active
         FROM bots_config b JOIN mt5_accounts a ON a.id = b.mt5_account_id AND a.user_id = b.user_id
         WHERE b.id = $1 AND b.user_id = $2
         FOR UPDATE OF b, a`,
        [botId, key.user_id],
      );
    } else {
      botResult = await this.client.query(
        `SELECT b.id, b.user_id, b.mt5_account_id, b.bot_name, b.max_daily_drawdown,
                b.max_lot_size, b.news_filter_enabled, b.performance_fee_rate, b.is_active,
                a.is_active AS account_is_active
         FROM bots_config b JOIN mt5_accounts a ON a.id = b.mt5_account_id AND a.user_id = b.user_id
         WHERE b.user_id = $1
         ORDER BY b.is_active DESC, b.created_at LIMIT 2`,
        [key.user_id],
      );
      if (botResult.rows.length !== 1) botResult.rows = [];
    }

    const botRow = botResult.rows[0] ?? null;
    let dailyNetPnl = 0;
    if (botRow) {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const pnlResult = await this.client.query(
        `SELECT COALESCE(SUM(profit_loss), 0) AS net_pnl
         FROM trade_logs WHERE bot_id = $1 AND profit_loss_currency = 'USD'
           AND created_at >= $2 AND created_at < $3`,
        [botRow.id, dayStart, dayEnd],
      );
      dailyNetPnl = Number(pnlResult.rows[0]?.net_pnl || 0);
    }

    return {
      apiKeyId: key.api_key_id,
      apiKeyBotId: key.api_key_bot_id,
      userId: key.user_id,
      userSubscriptionTier: key.user_subscription_tier,
      walletBalance: key.wallet_balance,
      subscriptionActive,
      subscription,
      bot: botRow ? {
        id: botRow.id,
        bot_name: botRow.bot_name,
        mt5_account_id: botRow.mt5_account_id,
        max_daily_drawdown: botRow.max_daily_drawdown,
        max_lot_size: botRow.max_lot_size,
        news_filter_enabled: botRow.news_filter_enabled,
        performance_fee_rate: botRow.performance_fee_rate,
        is_active: botRow.is_active,
      } : null,
      mt5Account: botRow ? { id: botRow.mt5_account_id, is_active: botRow.account_is_active } : null,
      dailyNetPnl,
    };
  }

  async enqueueCommand({ id, context, signal, maxPendingSignals }) {
    const payload = {
      signal_id: signal.signalId,
      action: signal.action,
      source_symbol: signal.sourceSymbol,
      symbol: signal.symbol,
      lot: signal.lot,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      stop_loss_type: signal.stopLossType,
      take_profit_type: signal.takeProfitType,
      bot_id: context.bot.id,
    };
    const existingResult = await this.client.query(
      `SELECT id, status, payload FROM execution_commands
       WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [context.userId, signal.signalId],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      return stableStringify(existing.payload) === stableStringify(payload)
        ? { kind: 'duplicate', id: existing.id, status: existing.status, userId: context.userId, botId: context.bot.id, mt5AccountId: context.mt5Account.id }
        : { kind: 'idempotency_conflict' };
    }

    await this.client.query('SELECT pg_advisory_xact_lock($1)', [5419202602]);
    const pendingResult = await this.client.query(
      `SELECT COUNT(*)::int AS count FROM execution_commands WHERE status IN ('QUEUED', 'CLAIMED')`,
    );
    if (Number(pendingResult.rows[0]?.count || 0) >= maxPendingSignals) return { kind: 'queue_full' };

    const inserted = await this.client.query(
      `INSERT INTO execution_commands
         (id, user_id, api_key_id, bot_id, mt5_account_id, idempotency_key, action,
          source_symbol, symbol, lot, stop_loss, take_profit, stop_loss_type,
          take_profit_type, performance_fee_rate, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       RETURNING id, status, received_at`,
      [id, context.userId, context.apiKeyId, context.bot.id, context.mt5Account.id,
        signal.signalId, signal.action, signal.sourceSymbol, signal.symbol, signal.lot ?? 0,
        signal.stopLoss, signal.takeProfit, signal.stopLossType, signal.takeProfitType,
        context.bot.performance_fee_rate, JSON.stringify(payload)],
    );
    await this.client.query("SELECT pg_notify('farhood_execution_commands', $1)", [context.mt5Account.id]);
    return {
      kind: 'queued',
      ...inserted.rows[0],
      userId: context.userId,
      botId: context.bot.id,
      mt5AccountId: context.mt5Account.id,
    };
  }

  async claimNext(accountId, bridgeId, leaseMs, minWalletBalanceUsd = 0) {
    const account = await this.client.query(
      `SELECT id, user_id FROM mt5_accounts WHERE id = $1 AND is_active = TRUE FOR UPDATE`,
      [accountId],
    );
    if (!account.rows[0]) return null;
    const now = new Date();
    await this.client.query(
      `UPDATE execution_commands
       SET status = 'QUEUED', claimed_by = NULL, lease_token = NULL, lease_until = NULL, updated_at = now()
       WHERE mt5_account_id = $1 AND status = 'CLAIMED' AND lease_until <= $2`,
      [accountId, now],
    );
    const walletBelowMinimum = await this.enforceWalletMinimum(account.rows[0].user_id, minWalletBalanceUsd);
    const result = await this.client.query(
      `SELECT id, idempotency_key, action, source_symbol, symbol, lot, stop_loss, take_profit,
              stop_loss_type, take_profit_type, received_at, attempt_count
       FROM execution_commands
       WHERE mt5_account_id = $1 AND status = 'QUEUED'
         AND ($2::boolean = FALSE OR action IN ('CLOSE', 'PANIC'))
       ORDER BY priority DESC, received_at, id
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [accountId, walletBelowMinimum],
    );
    const row = result.rows[0];
    if (!row) return null;
    const leaseToken = randomUUID();
    const updated = await this.client.query(
      `UPDATE execution_commands
       SET status = 'CLAIMED', attempt_count = attempt_count + 1, claimed_by = $2,
           lease_token = $3, lease_until = $4, updated_at = now()
       WHERE id = $1
       RETURNING attempt_count`,
      [row.id, bridgeId, leaseToken, new Date(Date.now() + leaseMs)],
    );
    return {
      id: row.id,
      lease_token: leaseToken,
      attempt: updated.rows[0].attempt_count,
      created_at_ms: new Date(row.received_at).getTime(),
      signal_id: row.idempotency_key,
      action: row.action,
      source_symbol: row.source_symbol,
      symbol: row.symbol,
      lot: Number(row.lot),
      stop_loss: row.stop_loss === null ? null : Number(row.stop_loss),
      take_profit: row.take_profit === null ? null : Number(row.take_profit),
      stop_loss_type: row.stop_loss_type,
      take_profit_type: row.take_profit_type,
    };
  }

  async completeCommand(commandId, leaseToken, accountId, result, minWalletBalanceUsd = 0) {
    const ownerResult = await this.client.query(
      `SELECT user_id FROM execution_commands WHERE id = $1 AND mt5_account_id = $2`,
      [commandId, accountId],
    );
    const owner = ownerResult.rows[0];
    if (!owner) return { kind: 'not_found' };
    await this.client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner.user_id]);

    const commandResult = await this.client.query(
      `SELECT c.id, c.user_id, c.bot_id, c.mt5_account_id, c.action, c.symbol, c.lot,
              c.received_at, c.status, c.lease_token, c.performance_fee_rate
       FROM execution_commands c
       WHERE c.id = $1 AND c.mt5_account_id = $2
       FOR UPDATE`,
      [commandId, accountId],
    );
    const command = commandResult.rows[0];
    if (!command) return { kind: 'not_found' };
    if (command.status !== 'CLAIMED' || command.lease_token !== leaseToken) {
      return { kind: 'stale', status: command.status };
    }

    const now = new Date();
    const executionLatencyMs = Math.max(0, now.getTime() - new Date(command.received_at).getTime());
    const status = result.success ? 'EXECUTED' : 'FAILED';
    await this.client.query(
      `UPDATE execution_commands
       SET status = $2, result_json = $3::jsonb, execution_latency_ms = $4,
           claimed_by = NULL, lease_token = NULL, lease_until = NULL, updated_at = $5
       WHERE id = $1`,
      [command.id, status, JSON.stringify(result), executionLatencyMs, now],
    );

    let feeDeducted = 0;
    let walletBalanceAfter = null;
    const executedLot = Number(result.executed_lot || 0);
    const hasBrokerFill = command.action !== 'PANIC' && Boolean(result.deal) && executedLot > 0;
    if (command.action === 'PANIC' && result.success) {
      await this.client.query('DELETE FROM mt5_positions WHERE mt5_account_id = $1', [command.mt5_account_id]);
    }
    if (hasBrokerFill) {
      const userResult = await this.client.query(
        `SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE`,
        [command.user_id],
      );
      if (!userResult.rows[0]) throw new Error('Trade user disappeared before trade log insert');
      const balance = Number(userResult.rows[0].wallet_balance);
      const profitLoss = Number(result.profit_loss || 0);
      const currency = result.profit_loss_currency || 'USD';
      if (command.action === 'CLOSE' && currency === 'USD' && profitLoss > 0) {
        feeDeducted = Math.min(balance, Math.round(profitLoss * Number(command.performance_fee_rate) * 100) / 100);
      }
      if (feeDeducted > 0) {
        const walletResult = await this.client.query(
          `UPDATE users SET wallet_balance = wallet_balance - $2, updated_at = now()
           WHERE id = $1 RETURNING wallet_balance`,
          [command.user_id, feeDeducted],
        );
        walletBalanceAfter = Number(walletResult.rows[0].wallet_balance);
        await this.client.query(
          `INSERT INTO wallet_transactions
             (id,user_id,transaction_type,amount_usd,balance_after,reference_type,reference_id,
              idempotency_key,description,metadata)
           VALUES ($1,$2,'PERFORMANCE_FEE',$3,$4,'trade', $5,$6,$7,$8::jsonb)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [randomUUID(), command.user_id, -feeDeducted, walletBalanceAfter, command.id,
            `performance-fee:${command.id}`, `Performance fee for ${command.symbol} close`,
            JSON.stringify({ trade_command_id: command.id, rate: Number(command.performance_fee_rate), gross_profit_usd: profitLoss })],
        );
      } else {
        walletBalanceAfter = balance;
      }
      await this.client.query(
        `INSERT INTO trade_logs
           (id, user_id, bot_id, command_id, symbol, action, lot, profit_loss,
            profit_loss_currency, performance_fee_deducted, execution_price,
            broker_order_id, broker_deal_id, broker_retcode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [randomUUID(), command.user_id, command.bot_id, command.id, command.symbol,
          command.action, executedLot, profitLoss, currency, feeDeducted,
          result.price ?? null, result.order ?? null, result.deal ?? null, result.retcode ?? null],
      );
      await this.enqueueNotification({
        userId: command.user_id,
        eventType: command.action === 'CLOSE' ? 'TRADE_CLOSE' : 'TRADE_OPEN',
        payload: {
          symbol: command.symbol,
          action: command.action,
          lot: executedLot,
          price: result.price ?? null,
          profit_loss: profitLoss,
          currency,
          fee_deducted: feeDeducted,
        },
        idempotencyKey: `trade-executed:${command.id}`,
      });
      if (feeDeducted > 0) await this.enforceWalletMinimum(command.user_id, minWalletBalanceUsd);
    }

    return {
      kind: 'completed',
      id: command.id,
      userId: command.user_id,
      status,
      executionLatencyMs,
      tradeLogged: hasBrokerFill,
      profitLoss: hasBrokerFill ? Number(result.profit_loss || 0) : null,
      feeDeducted,
      walletBalanceAfter,
      result,
    };
  }
}
