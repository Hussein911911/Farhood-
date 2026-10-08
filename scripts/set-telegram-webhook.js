import dotenv from 'dotenv';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
if (!token || !secret || !webhookUrl) {
  throw new Error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and TELEGRAM_WEBHOOK_URL in the server environment');
}
const url = new URL(webhookUrl);
if (url.protocol !== 'https:' || url.pathname !== '/api/v1/notifications/telegram/webhook') {
  throw new Error('TELEGRAM_WEBHOOK_URL must be an HTTPS URL ending in /api/v1/notifications/telegram/webhook');
}
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  }),
  signal: AbortSignal.timeout(10000),
});
const payload = await response.json().catch(() => null);
if (!response.ok || !payload?.ok) {
  throw new Error(`Telegram setWebhook failed with HTTP ${response.status}: ${payload?.description || 'unknown error'}`);
}
console.log(JSON.stringify({ ok: true, webhook_url: webhookUrl, description: payload.description || 'Webhook configured' }));
