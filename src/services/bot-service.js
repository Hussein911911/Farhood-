import { randomUUID } from 'node:crypto';

export class BotService {
  constructor({ repository }) {
    this.repository = repository;
  }

  async createForUser(userId, input) {
    const botName = typeof input.bot_name === 'string' ? input.bot_name.trim() : '';
    const maxDailyDrawdown = Number(input.max_daily_drawdown);
    const maxLotSize = Number(input.max_lot_size);
    const performanceFeeRate = input.performance_fee_rate === undefined ? 0.1 : Number(input.performance_fee_rate);
    if (botName.length < 1 || botName.length > 64) throw badRequest('bot_name must contain 1-64 characters');
    if (!isUuid(input.mt5_account_id)) throw badRequest('mt5_account_id must be a UUID');
    if (!Number.isFinite(maxDailyDrawdown) || maxDailyDrawdown <= 0) throw badRequest('max_daily_drawdown must be greater than 0 USD');
    if (!Number.isFinite(maxLotSize) || maxLotSize <= 0) throw badRequest('max_lot_size must be greater than 0');
    if (typeof input.news_filter_enabled !== 'undefined' && typeof input.news_filter_enabled !== 'boolean') {
      throw badRequest('news_filter_enabled must be a boolean');
    }
    if (!Number.isFinite(performanceFeeRate) || performanceFeeRate < 0 || performanceFeeRate > 1) {
      throw badRequest('performance_fee_rate must be between 0 and 1');
    }
    return this.repository.createBotConfig({
      id: randomUUID(),
      userId,
      mt5AccountId: input.mt5_account_id,
      botName,
      maxDailyDrawdown,
      maxLotSize,
      newsFilterEnabled: input.news_filter_enabled ?? false,
      performanceFeeRate,
    });
  }

  async updateForUser(userId, botId, input) {
    if (!isUuid(botId)) throw badRequest('bot id must be a UUID');
    const patch = {};
    if (input.bot_name !== undefined) {
      if (typeof input.bot_name !== 'string' || input.bot_name.trim().length < 1 || input.bot_name.trim().length > 64) {
        throw badRequest('bot_name must contain 1-64 characters');
      }
      patch.botName = input.bot_name.trim();
    }
    if (input.max_daily_drawdown !== undefined) {
      patch.maxDailyDrawdown = Number(input.max_daily_drawdown);
      if (!Number.isFinite(patch.maxDailyDrawdown) || patch.maxDailyDrawdown <= 0) throw badRequest('max_daily_drawdown must be greater than 0 USD');
    }
    if (input.max_lot_size !== undefined) {
      patch.maxLotSize = Number(input.max_lot_size);
      if (!Number.isFinite(patch.maxLotSize) || patch.maxLotSize <= 0) throw badRequest('max_lot_size must be greater than 0');
    }
    if (input.news_filter_enabled !== undefined) {
      if (typeof input.news_filter_enabled !== 'boolean') throw badRequest('news_filter_enabled must be a boolean');
      patch.newsFilterEnabled = input.news_filter_enabled;
    }
    if (input.performance_fee_rate !== undefined) {
      patch.performanceFeeRate = Number(input.performance_fee_rate);
      if (!Number.isFinite(patch.performanceFeeRate) || patch.performanceFeeRate < 0 || patch.performanceFeeRate > 1) {
        throw badRequest('performance_fee_rate must be between 0 and 1');
      }
    }
    if (input.is_active !== undefined) {
      if (typeof input.is_active !== 'boolean') throw badRequest('is_active must be a boolean');
      patch.isActive = input.is_active;
    }
    if (Object.keys(patch).length === 0) throw badRequest('at least one bot field must be supplied');
    const result = await this.repository.updateBotConfig(userId, botId, patch);
    if (result?.kind === 'panic_pending') {
      throw Object.assign(new Error('Wait for the account panic command to finish before reactivating this bot'), {
        statusCode: 409,
        code: 'panic_pending',
      });
    }
    return result;
  }

  listForUser(userId) {
    return this.repository.listBotConfigs(userId);
  }
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: 'invalid_bot_config' });
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
