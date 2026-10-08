import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { ApiKeyService } from './services/api-key-service.js';
import { AuthError, AuthService } from './services/auth-service.js';
import { BotService } from './services/bot-service.js';
import { Mt5AccountService } from './services/mt5-account-service.js';
import { ServiceError } from './services/service-error.js';
import { WebhookService } from './services/webhook-service.js';
import { hashBridgeKey } from './security/secrets.js';
import { SymbolMapper } from './symbol-mapper.js';
import { createLogger } from './logger.js';
import { PollNotifier } from './notifier.js';
import { PayloadValidationError, validateExecutionResult, validateSignal } from './validation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function bearerFromRequest(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function parseWaitMs(raw, defaultValue) {
  if (raw === undefined) return defaultValue;
  if (typeof raw !== 'string' || !/^\d{1,5}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= 25000 ? value : null;
}

function validatePositionSnapshot(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.positions)) {
    throw new PayloadValidationError('positions must be an array');
  }
  if (body.positions.length > 100) throw new PayloadValidationError('positions cannot contain more than 100 items');
  return body.positions.map((position, index) => {
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new PayloadValidationError(`positions[${index}] must be an object`);
    }
    const ticket = typeof position.ticket === 'string' ? position.ticket : String(position.ticket ?? '');
    const symbol = typeof position.symbol === 'string' ? position.symbol : '';
    const side = typeof position.side === 'string' ? position.side.toUpperCase() : '';
    const currency = typeof position.currency === 'string' ? position.currency.toUpperCase() : '';
    const volume = position.volume;
    const openPrice = position.open_price;
    const currentPnl = position.current_pnl;
    const magicNumber = position.magic_number;
    const openedAt = position.opened_at;
    if (!/^[0-9]{1,32}$/.test(ticket)) throw new PayloadValidationError(`positions[${index}].ticket is invalid`);
    if (!/^[A-Za-z0-9._#-]{1,32}$/.test(symbol)) throw new PayloadValidationError(`positions[${index}].symbol is invalid`);
    if (!['BUY', 'SELL'].includes(side)) throw new PayloadValidationError(`positions[${index}].side must be BUY or SELL`);
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume <= 0 || volume > 10000) {
      throw new PayloadValidationError(`positions[${index}].volume is invalid`);
    }
    if (typeof openPrice !== 'number' || !Number.isFinite(openPrice) || openPrice <= 0 || openPrice > 1e9) {
      throw new PayloadValidationError(`positions[${index}].open_price is invalid`);
    }
    if (typeof currentPnl !== 'number' || !Number.isFinite(currentPnl) || Math.abs(currentPnl) > 1e9) {
      throw new PayloadValidationError(`positions[${index}].current_pnl is invalid`);
    }
    if (!/^[A-Z]{3}$/.test(currency)) throw new PayloadValidationError(`positions[${index}].currency must be a three-letter code`);
    if (!Number.isSafeInteger(magicNumber) || magicNumber < 0) throw new PayloadValidationError(`positions[${index}].magic_number is invalid`);
    if (!Number.isSafeInteger(openedAt) || openedAt < 0 || openedAt > Math.floor(Date.now() / 1000) + 86400) {
      throw new PayloadValidationError(`positions[${index}].opened_at must be Unix seconds`);
    }
    return {
      ticket,
      symbol,
      side,
      volume,
      openPrice,
      currentPnl,
      currency,
      magicNumber,
      openedAt: new Date(openedAt * 1000),
    };
  });
}

function publicUser(user, authService) {
  return authService.toPublicUser(user);
}

export function createApp({ config, repository, logger = createLogger(), notifier = new PollNotifier(), symbolMapper } = {}) {
  if (!config || !repository) throw new Error('createApp requires config and repository');

  const mapper = symbolMapper || new SymbolMapper(config.symbolMap || '');
  const authService = new AuthService({
    repository,
    sessionPepper: config.sessionPepper,
    sessionTtlHours: config.sessionTtlHours,
  });
  const apiKeyService = new ApiKeyService({ repository, apiKeyPepper: config.apiKeyPepper });
  const mt5AccountService = new Mt5AccountService({
    repository,
    apiKeyPepper: config.apiKeyPepper,
    mt5EncryptionKey: config.mt5EncryptionKey,
  });
  const botService = new BotService({ repository });
  const webhookService = new WebhookService({ repository, apiKeyService, config });
  const bridgeState = new Map();

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    req.receivedAtMs = Date.now();
    req.startedAt = process.hrtime.bigint();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  app.use(express.json({ limit: '64kb', strict: true, type: 'application/json' }));

  const requireSession = asyncHandler(async (req, res, next) => {
    const token = bearerFromRequest(req);
    const user = token ? await authService.authenticate(token) : null;
    if (!user) return res.status(401).json({ error: 'unauthorized', message: 'A valid session bearer token is required' });
    req.sessionToken = token;
    req.user = user;
    return next();
  });

  const authenticateBridge = async (req, res) => {
    const bridgeId = req.get('x-bridge-id')?.trim() || '';
    const bridgeKey = bearerFromRequest(req);
    if (!UUID_PATTERN.test(bridgeId) || !bridgeKey || bridgeKey.length > 256) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    const account = await repository.authenticateBridge(bridgeId, hashBridgeKey(bridgeKey, config.apiKeyPepper));
    if (!account) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    bridgeState.set(account.id, Date.now());
    return account;
  };

  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

  app.get('/readyz', asyncHandler(async (_req, res) => {
    const bridgeCount = await repository.bridgeReadiness(config.bridgeStaleMs);
    const ready = bridgeCount > 0;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'degraded',
      database: 'ok',
      connected_mt5_bridges: bridgeCount,
    });
  }));

  app.post('/api/v1/auth/register', asyncHandler(async (req, res) => {
    const user = await authService.register(req.body || {});
    logger.info('user_registered', { request_id: req.requestId, user_id: user.id });
    return res.status(201).json({ user: publicUser(user, authService) });
  }));

  app.post('/api/v1/auth/login', asyncHandler(async (req, res) => {
    const session = await authService.login(req.body || {});
    logger.info('user_session_created', { request_id: req.requestId, user_id: session.user.id });
    return res.status(200).json({
      token_type: 'Bearer',
      access_token: session.token,
      expires_at: session.expiresAt.toISOString(),
      user: session.user,
    });
  }));

  app.post('/api/v1/auth/logout', requireSession, asyncHandler(async (req, res) => {
    await authService.logout(req.sessionToken);
    return res.status(204).end();
  }));

  app.get('/api/v1/me', requireSession, (req, res) => {
    return res.status(200).json({ user: publicUser(req.user, authService) });
  });

  app.post('/api/v1/api-keys', requireSession, asyncHandler(async (req, res) => {
    const key = await apiKeyService.createForUser(req.user.id, {
      label: req.body?.label,
      botId: req.body?.bot_id ?? null,
    });
    logger.info('api_key_created', {
      request_id: req.requestId,
      user_id: req.user.id,
      api_key_id: key.id,
      bot_id: key.bot_id,
    });
    return res.status(201).json({
      id: key.id,
      bot_id: key.bot_id,
      label: key.label,
      key_prefix: key.key_prefix,
      is_active: key.is_active,
      created_at: key.created_at,
      secret_key: key.secret_key,
      warning: 'Copy this key now; it cannot be retrieved again.',
    });
  }));

  app.get('/api/v1/api-keys', requireSession, asyncHandler(async (req, res) => {
    const keys = await repository.listApiKeys(req.user.id);
    return res.status(200).json({ api_keys: keys });
  }));

  app.delete('/api/v1/api-keys/:id', requireSession, asyncHandler(async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const key = await repository.revokeApiKey(req.user.id, req.params.id);
    return key ? res.status(204).end() : res.status(404).json({ error: 'api_key_not_found' });
  }));

  app.post('/api/v1/mt5-accounts', requireSession, asyncHandler(async (req, res) => {
    const account = await mt5AccountService.createForUser(req.user.id, req.body || {});
    logger.info('mt5_account_registered', {
      request_id: req.requestId,
      user_id: req.user.id,
      mt5_account_id: account.id,
    });
    return res.status(201).json({
      ...account,
      bridge_key: account.bridge_key,
      warning: 'Copy bridge_id and bridge_key into the MT5 EA now. The bridge key is shown only once.',
    });
  }));

  app.get('/api/v1/mt5-accounts', requireSession, asyncHandler(async (req, res) => {
    const accounts = await repository.listMt5Accounts(req.user.id);
    return res.status(200).json({ mt5_accounts: accounts });
  }));

  app.post('/api/v1/mt5-accounts/:id/rotate-bridge-key', requireSession, asyncHandler(async (req, res) => {
    const result = await mt5AccountService.rotateBridgeCredential(req.user.id, req.params.id);
    if (result.kind === 'not_found') return res.status(404).json({ error: 'mt5_account_not_found' });
    if (result.kind === 'busy') return res.status(409).json({ error: 'commands_in_flight', message: 'Wait for claimed MT5 commands to finish before rotating bridge credentials' });
    return res.status(200).json({
      ...result.account,
      bridge_key: result.bridge_key,
      warning: 'Copy the new bridge_id and bridge_key now. The previous key was invalidated.',
    });
  }));

  app.delete('/api/v1/mt5-accounts/:id', requireSession, asyncHandler(async (req, res) => {
    const result = await mt5AccountService.deactivate(req.user.id, req.params.id);
    if (result.kind === 'not_found') return res.status(404).json({ error: 'mt5_account_not_found' });
    if (result.kind === 'busy') return res.status(409).json({ error: 'commands_in_flight', message: 'Wait for claimed MT5 commands to finish before deactivating this account' });
    return res.status(204).end();
  }));

  app.post('/api/v1/mt5-accounts/:id/activate', requireSession, asyncHandler(async (req, res) => {
    const result = await mt5AccountService.activateWithNewCredential(req.user.id, req.params.id);
    if (result.kind === 'not_found') return res.status(404).json({ error: 'mt5_account_not_found' });
    if (result.kind === 'already_active') return res.status(409).json({ error: 'mt5_account_already_active' });
    return res.status(200).json({
      ...result.account,
      bridge_key: result.bridge_key,
      warning: 'Copy the new bridge_id and bridge_key now. The previous bridge credential was replaced.',
    });
  }));

  app.post('/api/v1/bots', requireSession, asyncHandler(async (req, res) => {
    const bot = await botService.createForUser(req.user.id, req.body || {});
    return res.status(201).json({ bot });
  }));

  app.get('/api/v1/bots', requireSession, asyncHandler(async (req, res) => {
    return res.status(200).json({ bots: await botService.listForUser(req.user.id) });
  }));

  app.patch('/api/v1/bots/:id', requireSession, asyncHandler(async (req, res) => {
    const bot = await botService.updateForUser(req.user.id, req.params.id, req.body || {});
    return bot ? res.status(200).json({ bot }) : res.status(404).json({ error: 'bot_not_found' });
  }));

  app.post('/api/v1/bots/:id/panic', requireSession, asyncHandler(async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const result = await repository.panicBot(req.user.id, req.params.id);
    if (result.kind === 'not_found') return res.status(404).json({ error: 'bot_not_found' });
    if (result.kind === 'account_inactive') {
      return res.status(409).json({ error: 'mt5_account_inactive', message: 'The account bridge must be reactivated before MT5 positions can be closed.' });
    }
    const bridgeOnline = Boolean(result.lastSeenAt)
      && Date.now() - new Date(result.lastSeenAt).getTime() <= config.bridgeStaleMs;
    logger.warn('panic_command_queued', {
      request_id: req.requestId,
      user_id: req.user.id,
      bot_id: req.params.id,
      mt5_account_id: result.accountId,
      job_id: result.id,
      bridge_online: bridgeOnline,
    });
    notifier.notify(result.accountId);
    return res.status(202).json({
      accepted: true,
      id: result.id,
      status: result.status,
      bridge_online: bridgeOnline,
      message: bridgeOnline
        ? 'All bots on this MT5 account are paused. The EA will close positions managed by its magic number and remove itself after acknowledgement.'
        : 'All bots on this MT5 account are paused. The panic close is queued, but MT5 is offline; positions will not close until the EA reconnects.',
    });
  }));

  app.get('/api/v1/dashboard/overview', requireSession, asyncHandler(async (req, res) => {
    const overview = await repository.getDashboardOverview(req.user.id);
    if (!overview) return res.status(404).json({ error: 'user_not_found' });
    return res.status(200).json(overview);
  }));

  app.get('/api/v1/subscriptions', requireSession, asyncHandler(async (req, res) => {
    const subscriptions = await repository.listSubscriptions(req.user.id);
    return res.status(200).json({ subscriptions });
  }));

  app.get('/api/v1/trade-logs', requireSession, asyncHandler(async (req, res) => {
    const limitRaw = req.query.limit ?? '50';
    const offsetRaw = req.query.offset ?? '0';
    if (!/^\d{1,3}$/.test(String(limitRaw)) || !/^\d{1,8}$/.test(String(offsetRaw))) {
      return res.status(400).json({ error: 'invalid_pagination' });
    }
    const limit = Number(limitRaw);
    const offset = Number(offsetRaw);
    if (limit < 1 || limit > 100) return res.status(400).json({ error: 'limit_must_be_1_to_100' });
    const tradeLogs = await repository.listTradeLogs(req.user.id, { limit, offset });
    return res.status(200).json({ trade_logs: tradeLogs, limit, offset });
  }));

  app.post('/api/v1/webhook', asyncHandler(async (req, res) => {
    if (typeof req.body?.secret_key !== 'string' || req.body.secret_key.length < 32 || req.body.secret_key.length > 256) {
      return res.status(401).json({ error: 'unauthorized', message: 'A valid user API key is required in secret_key' });
    }
    const signal = validateSignal(req.body, {
      maxLot: config.maxLot,
      idempotencyHeader: req.get('idempotency-key'),
    });
    signal.symbol = mapper.map(signal.sourceSymbol);
    const queued = await webhookService.accept(signal);
    if (queued.kind === 'queued') notifier.notify(queued.mt5AccountId);
    const duplicate = queued.kind === 'duplicate';
    const processingMs = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    logger.info('webhook_accepted', {
      request_id: req.requestId,
      job_id: queued.id,
      user_id: queued.userId,
      bot_id: queued.botId,
      signal_id: signal.signalId,
      action: signal.action,
      source_symbol: signal.sourceSymbol,
      mt5_symbol: signal.symbol,
      duplicate,
      request_processing_ms: Number(processingMs.toFixed(3)),
    });
    return res.status(duplicate ? 200 : 202).json({
      accepted: true,
      duplicate,
      id: queued.id,
      status: queued.status,
    });
  }));

  app.post('/api/v1/mt5/positions/sync', asyncHandler(async (req, res) => {
    const account = await authenticateBridge(req, res);
    if (!account) return;
    const positions = validatePositionSnapshot(req.body || {});
    const result = await repository.syncMt5Positions(account.id, account.user_id, positions);
    if (result.kind === 'not_found') return res.status(409).json({ error: 'mt5_account_inactive' });
    return res.status(200).json({ synced: true, position_count: result.count });
  }));

  app.get('/api/v1/mt5/commands/next', asyncHandler(async (req, res) => {
    const account = await authenticateBridge(req, res);
    if (!account) return;
    const waitMs = parseWaitMs(req.query.wait_ms, config.bridgePollWaitMs);
    if (waitMs === null) return res.status(400).json({ error: 'invalid_wait_ms' });

    const deadline = Date.now() + waitMs;
    while (!req.destroyed) {
      const command = await repository.claimNext(account.id, account.bridge_id, config.bridgeLeaseMs);
      if (command) return res.status(200).json(command);
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await notifier.wait(remainingMs, account.id);
    }
    return res.status(204).end();
  }));

  app.post('/api/v1/mt5/commands/:id/result', asyncHandler(async (req, res) => {
    const account = await authenticateBridge(req, res);
    if (!account) return;
    if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'invalid_command_id' });
    const leaseToken = req.body?.lease_token;
    if (typeof leaseToken !== 'string' || !UUID_PATTERN.test(leaseToken)) {
      throw new PayloadValidationError('lease_token is required and must be a UUID');
    }
    const result = validateExecutionResult(req.body);
    const completion = await repository.completeCommand(req.params.id, leaseToken, account.id, result);
    if (completion.kind === 'not_found') return res.status(404).json({ error: 'command_not_found' });
    if (completion.kind === 'stale') {
      return res.status(409).json({ error: 'stale_or_already_completed_command', status: completion.status });
    }

    const fields = {
      request_id: req.requestId,
      job_id: completion.id,
      user_id: completion.userId,
      bridge_id: account.bridge_id,
      status: completion.status,
      success: result.success,
      retcode: result.retcode ?? null,
      order: result.order ?? null,
      deal: result.deal ?? null,
      trade_logged: completion.tradeLogged,
      profit_loss: completion.profitLoss,
      fee_deducted: completion.feeDeducted,
      wallet_balance_after: completion.walletBalanceAfter,
      execution_latency_ms: completion.executionLatencyMs,
      message: result.message ?? null,
    };
    if (result.success) logger.info('mt5_execution_confirmed', fields);
    else logger.warn('mt5_execution_failed', fields);
    return res.status(200).json({
      accepted: true,
      id: completion.id,
      status: completion.status,
      execution_latency_ms: completion.executionLatencyMs,
      trade_logged: completion.tradeLogged,
      performance_fee_deducted: completion.feeDeducted,
    });
  }));

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  app.use((error, req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof PayloadValidationError) {
      return res.status(error.statusCode).json({ error: 'invalid_payload', message: error.message });
    }
    if (error instanceof ServiceError || error instanceof AuthError || error.statusCode) {
      return res.status(error.statusCode || 400).json({
        error: error.code || 'request_error',
        message: error.message,
      });
    }
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON' });
    }
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    if (error?.code === '23505') return res.status(409).json({ error: 'duplicate_resource' });
    if (error?.code === '23503') return res.status(404).json({ error: 'related_resource_not_found' });
    if (error?.code === '22P02') return res.status(400).json({ error: 'invalid_identifier_or_value' });

    logger.error('request_error', {
      request_id: req.requestId,
      method: req.method,
      path: req.path,
      message: error?.message || 'Unknown error',
    });
    return res.status(500).json({ error: 'internal_server_error' });
  });

  app.locals.bridgeState = bridgeState;
  app.locals.services = { authService, apiKeyService, mt5AccountService, botService, webhookService };
  return app;
}
