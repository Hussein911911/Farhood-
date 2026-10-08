import { randomBytes } from 'node:crypto';
import { hashTelegramConnectCode } from '../security/secrets.js';
import { ServiceError } from './service-error.js';

export class TelegramBotClient {
  constructor({ botToken = '', fetchImpl = globalThis.fetch } = {}) {
    this.botToken = botToken;
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.botToken && this.fetch);
  }

  async sendMessage(chatId, text) {
    if (!this.configured) throw new Error('Telegram bot is not configured');
    let response;
    try {
      response = await this.fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new Error('Telegram API request failed', { cause: error });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(`Telegram rejected the notification (HTTP ${response.status})`);
    return payload.result;
  }
}

export class TelegramService {
  constructor({ repository, config, client }) {
    this.repository = repository;
    this.config = config;
    this.client = client;
  }

  get enabled() {
    return Boolean(this.config.telegramEnabled && this.config.telegramWebhookSecret && this.client?.configured);
  }

  async createConnectCode(userId) {
    if (!this.enabled) throw new ServiceError('telegram_not_configured', 'Telegram notifications are not configured', 503);
    const code = `fh_${randomBytes(24).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + (this.config.telegramConnectCodeTtlMinutes ?? 15) * 60 * 1000);
    await this.repository.createTelegramConnectCode({
      userId,
      tokenHash: hashTelegramConnectCode(code, this.config.sessionPepper),
      expiresAt,
    });
    const username = this.config.telegramBotUsername || null;
    return {
      code,
      bot_username: username,
      deep_link: username ? `https://t.me/${username}?start=${code}` : null,
      command: `/start ${code}`,
      expires_at: expiresAt.toISOString(),
    };
  }

  async handleUpdate(update) {
    if (!this.enabled) throw new ServiceError('telegram_not_configured', 'Telegram notifications are not configured', 503);
    const updateId = update?.update_id;
    const message = update?.message;
    const chatId = message?.chat?.id;
    const text = typeof message?.text === 'string' ? message.text.trim() : '';
    if (!Number.isSafeInteger(updateId) || updateId < 0 || (typeof chatId !== 'string' && typeof chatId !== 'number')) {
      return { kind: 'ignored' };
    }
    const chat = String(chatId);
    if (!/^-?[0-9]{1,32}$/.test(chat)) return { kind: 'ignored' };

    const start = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{8,64}))?$/i.exec(text);
    if (start) {
      if (message.chat.type !== 'private' || !start[1]) {
        return { kind: 'invalid_start', chatId: chat };
      }
      const result = await this.repository.connectTelegram({
        updateId,
        tokenHash: hashTelegramConnectCode(start[1], this.config.sessionPepper),
        chatId: chat,
      });
      if (result.kind === 'invalid_code') {
        await this.client.sendMessage(chat, 'That Farhood connection code is invalid or expired. Generate a fresh code in your dashboard and try again.').catch(() => undefined);
      }
      if (result.kind === 'chat_in_use') {
        await this.client.sendMessage(chat, 'This Telegram account is already linked to another Farhood user. Unlink it there before connecting it again.').catch(() => undefined);
      }
      return result;
    }

    const stop = /^\/stop(?:@[A-Za-z0-9_]+)?$/i.test(text);
    if (stop) {
      const result = await this.repository.disconnectTelegram({ updateId, chatId: chat });
      await this.client.sendMessage(chat, 'Farhood Telegram notifications are now disconnected.').catch(() => undefined);
      return result;
    }

    if (!text.startsWith('/')) return { kind: 'ignored' };
    await this.client.sendMessage(chat, 'To link your account, generate a one-time connection code in Farhood and send /start followed by that code. Send /stop to disconnect notifications.').catch(() => undefined);
    return { kind: 'help' };
  }
}

export class TelegramNotificationWorker {
  constructor({ repository, client, logger = console, batchSize = 10, maxAttempts = 8 }) {
    this.repository = repository;
    this.client = client;
    this.logger = logger;
    this.batchSize = batchSize;
    this.maxAttempts = maxAttempts;
  }

  async runBatch() {
    const notifications = await this.repository.claimNotificationBatch({ limit: this.batchSize, maxAttempts: this.maxAttempts });
    let sent = 0;
    for (const notification of notifications) {
      if (!notification.chat_id) {
        await this.repository.skipNotification(notification.id);
        continue;
      }
      try {
        await this.client.sendMessage(notification.chat_id, formatNotification(notification));
        await this.repository.completeNotification(notification.id);
        sent++;
      } catch (error) {
        const attempt = Number(notification.attempt_count);
        const retryDelayMs = Math.min(15 * 60 * 1000, 1000 * (2 ** Math.min(attempt, 10)));
        await this.repository.retryNotification(notification.id, error?.message || 'Telegram delivery failed', {
          maxAttempts: this.maxAttempts,
          retryDelayMs,
        });
        this.logger.warn?.('telegram_notification_delivery_failed', {
          notification_id: notification.id,
          event_type: notification.event_type,
          attempt,
        });
      }
    }
    return { claimed: notifications.length, sent };
  }
}

function formatMoney(value, currency = 'USD') {
  const number = Number(value || 0);
  return `${currency} ${Number.isFinite(number) ? number.toFixed(2) : '0.00'}`;
}

export function formatNotification(notification) {
  const payload = notification.payload || {};
  switch (notification.event_type) {
    case 'TRADE_OPEN':
    case 'TRADE_CLOSE':
      return [
        notification.event_type === 'TRADE_OPEN' ? '📈 Trade opened' : '📕 Trade closed',
        `Symbol: ${payload.symbol || '—'}`,
        `Action: ${payload.action || '—'} · ${Number(payload.lot || 0).toFixed(2)} lot`,
        `Fill: ${payload.price ? String(payload.price) : 'not reported'}`,
        `Profit / loss: ${formatMoney(payload.profit_loss, payload.currency || 'USD')}`,
        `Performance fee: ${formatMoney(payload.fee_deducted)}`,
      ].join('\n');
    case 'WALLET_TOP_UP':
      return `✅ Wallet top-up confirmed\nCredited: ${formatMoney(payload.amount_usd)}\nNetwork: ${payload.network || 'USDT'}\nTransaction: ${payload.tx_hash || 'provider-confirmed'}`;
    case 'LOW_WALLET_BALANCE':
      return `⚠️ Low wallet balance\nAvailable: ${formatMoney(payload.balance_usd)}\nTrading entries are paused below ${formatMoney(payload.minimum_usd)}. Top up and manually review/resume bots.`;
    case 'DAILY_DRAWDOWN':
      return `🛑 Daily drawdown guard triggered\nBot: ${payload.bot_name || 'Trading bot'}\nRealized loss: ${formatMoney(payload.drawdown_usd)}\nLimit: ${formatMoney(payload.limit_usd)}\nThe bot was paused; review risk settings before resuming.`;
    case 'PANIC_ACTIVATED':
      return `🚨 Emergency panic activated\nAccount: ${payload.broker_server || 'MT5'} · ${payload.account_number || ''}\nBots on this account are paused. The EA close request must still be confirmed in MT5.`;
    case 'SUBSCRIPTION_RENEWED':
      return `🔄 Subscription renewed\nPlan: ${payload.tier || '—'}\nCharged: ${formatMoney(payload.amount_usd)}\nWallet balance: ${formatMoney(payload.balance_usd)}`;
    case 'SUBSCRIPTION_PAYMENT_FAILED':
      return `⚠️ Subscription renewal needs attention\nPlan: ${payload.tier || '—'}\nDue: ${formatMoney(payload.amount_usd)}\nYour plan is past due. Top up your wallet and renew from Billing.`;
    case 'TELEGRAM_CONNECTED':
      return '✅ Farhood Telegram alerts are connected. You will receive account, risk, trade, and billing notifications here.';
    default:
      return 'Farhood account notification. Open your dashboard for details.';
  }
}
