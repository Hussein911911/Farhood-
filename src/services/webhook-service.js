import { randomUUID } from 'node:crypto';
import { ServiceError } from './service-error.js';

export class WebhookService {
  constructor({ repository, apiKeyService, config }) {
    this.repository = repository;
    this.apiKeyService = apiKeyService;
    this.config = config;
  }

  async accept(signal) {
    const secretHash = this.apiKeyService.hashIncoming(signal.secretKey);
    if (!secretHash) throw new ServiceError('unauthorized', 'Invalid API key', 401);

    return this.repository.transaction(async (tx) => {
      const context = await tx.getWebhookContext(secretHash, signal.botId);
      if (!context) throw new ServiceError('unauthorized', 'Invalid or inactive API key', 401);
      if (context.apiKeyBotId && signal.botId && context.apiKeyBotId !== signal.botId) {
        throw new ServiceError('bot_scope_mismatch', 'This API key is scoped to a different bot', 403);
      }
      if (!context.subscriptionActive) {
        throw new ServiceError('subscription_inactive', 'An active subscription is required', 403);
      }
      if (Number(context.walletBalance) < this.config.minWalletBalanceUsd) {
        throw new ServiceError('insufficient_wallet_balance', 'Wallet balance is below the configured execution minimum', 402);
      }
      if (!context.bot) {
        throw new ServiceError('bot_not_found', signal.botId ? 'Bot not found for this user' : 'Create a bot or specify bot_id', 403);
      }
      if (!context.bot.is_active) {
        throw new ServiceError('bot_inactive', 'This bot is inactive', 403);
      }
      if (!context.mt5Account?.is_active) {
        throw new ServiceError('mt5_account_inactive', 'The bot MT5 account is inactive', 403);
      }
      if (context.bot.news_filter_enabled) {
        throw new ServiceError('news_filter_unavailable', 'This bot requires a news-filter provider, which is not configured', 503);
      }

      if (signal.action !== 'CLOSE') {
        const requestedLot = Number(signal.lot);
        if (requestedLot > this.config.maxLot || requestedLot > Number(context.bot.max_lot_size)) {
          throw new ServiceError('max_lot_exceeded', 'Requested lot exceeds the platform or bot max_lot_size', 403);
        }
        const dailyNetPnl = Number(context.dailyNetPnl || 0);
        const currentDrawdown = Math.max(0, -dailyNetPnl);
        if (currentDrawdown >= Number(context.bot.max_daily_drawdown)) {
          throw new ServiceError('daily_drawdown_limit', 'Bot max_daily_drawdown has been reached', 403);
        }
      }

      const queued = await tx.enqueueCommand({
        id: randomUUID(),
        context,
        signal,
        maxPendingSignals: this.config.maxPendingSignals,
      });
      if (queued.kind === 'queue_full') {
        throw new ServiceError('queue_full', 'Execution queue is at capacity; retry later', 503);
      }
      if (queued.kind === 'idempotency_conflict') {
        throw new ServiceError('idempotency_key_reused', 'This signal_id was already used with a different payload', 409);
      }
      return queued;
    });
  }
}
