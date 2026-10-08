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
    const result = await this.pool.query(
      `UPDATE bots_config SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, mt5_account_id, bot_name, max_daily_drawdown, max_lot_size,
                 news_filter_enabled, performance_fee_rate, is_active, created_at, updated_at`,
      [botId, userId, ...values],
    );
    return result.rows[0] ? toPublicBot(result.rows[0]) : null;
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

  async claimNext(accountId, bridgeId, leaseMs) {
    return this.transaction(async (tx) => tx.claimNext(accountId, bridgeId, leaseMs));
  }

  async completeCommand(commandId, leaseToken, accountId, result) {
    return this.transaction(async (tx) => tx.completeCommand(commandId, leaseToken, accountId, result));
  }
}

class PostgresTransaction {
  constructor(client) {
    this.client = client;
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
         WHERE b.user_id = $1 AND b.is_active = TRUE
         ORDER BY b.created_at LIMIT 2`,
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

  async claimNext(accountId, bridgeId, leaseMs) {
    const account = await this.client.query(
      `SELECT id FROM mt5_accounts WHERE id = $1 AND is_active = TRUE FOR UPDATE`,
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
    const result = await this.client.query(
      `SELECT id, idempotency_key, action, source_symbol, symbol, lot, stop_loss, take_profit,
              stop_loss_type, take_profit_type, received_at, attempt_count
       FROM execution_commands
       WHERE mt5_account_id = $1 AND status = 'QUEUED'
       ORDER BY received_at, id
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [accountId],
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

  async completeCommand(commandId, leaseToken, accountId, result) {
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
    const hasBrokerFill = Boolean(result.deal) && executedLot > 0;
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
