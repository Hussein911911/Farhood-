# Phase 4 — Crypto billing, wallet subscriptions, and Telegram alerts

Phase 4 adds server-authoritative USDT deposits through NOWPayments, a PostgreSQL wallet ledger, monthly wallet-funded subscriptions, profitable-trade fees, low-wallet execution guards, and Telegram alerts. The dashboard billing page is **`/dashboard/billing`**. This guide supplements—not replaces—the Phase 1, 2, and 3 guides.

> **Demo-first:** use a NOWPayments sandbox account and an MT5 demo account until the complete payment, webhook, wallet, renewal, and order-close paths have been reviewed. This software does not promise end-to-end execution latency below 100 ms or any trading outcome. Never test with funds you cannot afford to lose.

## 1. Requirements and database setup

- Node.js **20.18 or newer** and npm.
- PostgreSQL **14 or newer**. PostgreSQL is the source of truth; do not expose it to the browser or public internet.
- A public HTTPS API origin for payment-provider callbacks and (if enabled) Telegram webhooks.
- For deposits: a NOWPayments account with API key and IPN secret. For alerts: a Telegram bot token.

From the repository root:

```sh
npm install
cp .env.example .env
# Edit .env and set DATABASE_URL plus new, independent secrets.
npm run db:migrate
npm test
npm start
```

The migration runner applies numbered migrations under an advisory lock. Run migrations **before** starting the API; startup checks for Phase 2–4 tables and exits if the schema is incomplete. Back up production data before deployment. Migration `003_phase4_crypto_billing_telegram.sql` adds the wallet/deposit ledger, provider callback records, Telegram links/codes/updates, and notification outbox, and extends subscription and user state.

The example binds the API to loopback. For a container or reverse-proxy deployment, set `HOST=0.0.0.0`, set `PORT` to the internal API port, and allow only intended HTTPS traffic at the edge. Run the backend and database on private networking.

### Secret generation and environment variables

Generate distinct secrets and keep them in a secret manager or a permission-restricted server `.env` file. Do not commit `.env` or copy server secrets into `web/.env.local`.

```sh
openssl rand -hex 32   # use separate values for API_KEY_PEPPER and SESSION_PEPPER
openssl rand -base64 32 # MT5_ENCRYPTION_KEY (a random 32-byte AES key)
openssl rand -hex 32   # TELEGRAM_WEBHOOK_SECRET
```

| Variable | Purpose / expected value |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL for the backend only. |
| `API_KEY_PEPPER`, `SESSION_PEPPER` | Independent random values of at least 32 characters. Losing/rotating them invalidates associated API keys or sessions. |
| `MT5_ENCRYPTION_KEY` | Base64-encoded or hex-encoded 32-byte AES key. Back it up securely; encrypted MT5 investor passwords cannot be recovered without it. |
| `HOST`, `PORT`, `DB_POOL_MAX` | API listener, port, and PostgreSQL pool sizing. |
| `MIN_WALLET_BALANCE_USD` | Positive minimum for new entries; default is `$5.00`. |
| `PAYMENT_MIN_USD`, `PAYMENT_MAX_USD` | Deposit bounds; defaults are `$5.00` and `$10,000.00`. |
| `NOWPAYMENTS_API_KEY` | NOWPayments server API key. Required to create invoices. |
| `NOWPAYMENTS_API_BASE_URL` | `https://api-sandbox.nowpayments.io/v1` for sandbox, or `https://api.nowpayments.io/v1` for production. Only those official HTTPS hosts and `/v1` are accepted. |
| `NOWPAYMENTS_IPN_SECRET` | IPN secret used to validate `x-nowpayments-sig`. |
| `NOWPAYMENTS_CALLBACK_URL` | Public HTTPS URL ending in `/api/v1/payments/webhook`. It is sent with every payment request. |
| `SUBSCRIPTION_PRICES_USD` | JSON object with `BASIC`, `PLUS`, and `PRO` monthly prices (up to two decimals, positive, max `$10,000`). Example defaults are `$9.99`, `$19.99`, and `$49.99`; set your real prices before launch. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token; backend only. |
| `TELEGRAM_BOT_USERNAME` | Optional bot username, with or without `@`; enables a one-click `t.me` connect link. |
| `TELEGRAM_WEBHOOK_SECRET` | 1–256 characters containing only letters, digits, `_`, or `-`. Telegram sends this in its secret-token header. |
| `TELEGRAM_WEBHOOK_URL` | Public HTTPS URL ending in `/api/v1/notifications/telegram/webhook`. |
| `TELEGRAM_CONNECT_CODE_TTL_MINUTES` | One-time link-code lifetime; default is 15 minutes. |

Payments are enabled only when the API key, IPN secret, and callback URL are all set. Telegram is enabled only when the bot token and webhook secret are set. Use production credentials and the production NOWPayments URL only after completing sandbox checks; the app deliberately does not promote sandbox data into production.

### Start the Next.js dashboard

In another terminal:

```sh
cd web
npm install
cp .env.example .env.local
# Keep this server-side URL aligned with the Express API origin:
# BACKEND_API_URL=http://127.0.0.1:3000
npm run dev
```

Open `http://localhost:3001`, sign in, and go to **Billing**. The Next.js backend-for-frontend proxies requests to Express; the browser must not connect directly to PostgreSQL or receive provider/bot credentials. Use `BACKEND_API_URL` without a `NEXT_PUBLIC_` prefix.

## 2. Configure NOWPayments and USDT deposits

1. Create/test the NOWPayments API and IPN credentials in the provider dashboard. Configure the backend variables above. In production, `NOWPAYMENTS_CALLBACK_URL` must be reachable from the provider over HTTPS, with no login or browser session requirement.
2. Start the API after setting the variables. The provider client sends `price_currency: usd`, the selected USDT network currency, a unique order ID, and the IPN callback URL to NOWPayments. Supported network choices are:
   - **TRC20** → provider currency `usdttrc20`.
   - **BEP20** → provider currency `usdtbsc` (BNB Smart Chain / BEP20).
3. Sign in to the dashboard and open `/dashboard/billing`. Enter an amount within the configured limits, choose the network, then create the deposit. The page displays the invoice's network, provider address, exact token amount, expiry (when supplied), and QR code. Send only the displayed asset to that address on that exact network. A wrong-network transfer may be unrecoverable.
4. The API creates the invoice on the server. The wallet is **not** credited when an address is created, when a transaction is merely seen, or on intermediate provider states. Only a valid signed NOWPayments callback with `payment_status: FINISHED`, matching order, USD amount, and token/network details can credit the requested USD amount.
5. The provider callback is `POST /api/v1/payments/webhook`; it is unauthenticated by user session but requires the `x-nowpayments-sig` HMAC-SHA512 signature. The callback body is canonically key-sorted before signature validation. Invalid signatures, unsupported currencies/statuses, and mismatched invoice details are rejected. Provider event hashes, a per-deposit credit timestamp, and unique wallet-ledger idempotency keys prevent a repeated callback from crediting twice.

The browser never receives the NOWPayments API key or IPN secret. Do not manually adjust wallet balances in the database as a substitute for provider confirmation; wallet movements must be traceable through `wallet_transactions`.

### Billing and payment API

All user routes below require `Authorization: Bearer <session-token>` unless stated otherwise.

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/v1/billing/overview` | Wallet balance, wallet ledger, deposits, subscription state/plans, payment bounds, and integration availability for the signed-in user. |
| `POST` | `/api/v1/payments/create-deposit` | Create an invoice. JSON: `{"amount_usd":25,"network":"TRC20"}` or `{"amount_usd":25,"network":"BEP20"}`. Returns `201` with the deposit details. |
| `GET` | `/api/v1/payments/deposits/:id` | Read one of the signed-in user's deposits. |
| `POST` | `/api/v1/payments/webhook` | NOWPayments IPN callback; provider signature header required, no user session. |
| `GET` | `/api/v1/subscriptions` | Subscription history. |
| `POST` | `/api/v1/subscriptions/upgrade` | Charge the wallet immediately and start the requested `BASIC`, `PLUS`, or `PRO` plan. JSON: `{"tier":"PRO"}`. |

Example invoice request (use the user's real session token; do not place it in client source):

```sh
curl -X POST "$API_ORIGIN/api/v1/payments/create-deposit" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"amount_usd":25,"network":"TRC20"}'
```

A missing server integration returns `503`; out-of-range amounts or a network other than `TRC20`/`BEP20` return `400`. Provider-confirmed deposits and subscription charges/renewals appear in Billing and in the user's transaction history. Wallet amounts are USD ledger amounts; the UI separately displays the amount of USDT requested by the provider.

## 3. Wallet subscriptions, performance fees, and risk controls

### Monthly subscription billing

- A plan upgrade is a full monthly charge from the current wallet balance (no prorating). It is applied transactionally with the subscription change and a `SUBSCRIPTION_CHARGE` ledger entry. A same-plan request returns `409`; insufficient funds return `402`.
- The API process checks for due renewals every 60 seconds. A funded renewal deducts the configured tier price, writes a `SUBSCRIPTION_RENEWAL` ledger row, and advances the subscription by one month.
- If funds are insufficient, the subscription becomes `PAST_DUE`, the user's bots are paused, queued `BUY`/`SELL` commands are failed, and a notification is queued. Add funds, then select/renew the plan from Billing. Renewal processing is server-side; do not implement billing timers in the browser.
- Set `SUBSCRIPTION_PRICES_USD` before launch and communicate those terms clearly to users. Changing configured prices affects new upgrades and renewals; a subscription's saved monthly price is used for its renewal when present.

### Performance fees and wallet minimum

- Set `performance_fee_rate` per bot as a decimal fraction (for example, `0.10` means 10%). When MT5 confirms a filled `CLOSE` with positive USD profit, the server deducts `min(available wallet, profit × fee rate)` atomically with the trade log and writes a `PERFORMANCE_FEE` ledger row. No fee is taken on a loss, an opening trade, or non-USD P/L. Non-USD P/L is not converted; use USD-denominated demo accounts for fee verification.
- `MIN_WALLET_BALANCE_USD` defaults to `$5.00`. A wallet below the threshold pauses all of that user's bots, fails queued new-entry commands, and blocks new `BUY`/`SELL` entries. A low-balance Telegram alert is deduplicated until the balance returns to the threshold. Funding the wallet does **not** automatically resume bots; review risk and manually reactivate them.
- Risk-reducing `CLOSE` commands are still allowed through the API/bridge when the wallet is low or a subscription is no longer active, provided the MT5 account itself is active. Do not interpret this exception as a guarantee that the broker will fill a close. The MT5 terminal must be online, its EA must acknowledge execution, and broker rejection/market conditions still apply. Panic behavior and its acknowledgement limits remain described in the Phase 3 guide.
- The existing daily drawdown guard is based on broker-reported realized USD P/L since 00:00 UTC. It pauses a bot and blocks new entries at the limit; it is not an equity monitor and does not include floating losses. If a bot's news filter is enabled without a provider, new entries continue to fail closed.

## 4. Configure Telegram account and trade alerts

1. Create a bot using Telegram's BotFather. Store its token as `TELEGRAM_BOT_TOKEN`; optionally set `TELEGRAM_BOT_USERNAME` without the leading `@`.
2. Set a high-entropy `TELEGRAM_WEBHOOK_SECRET`, a public HTTPS `TELEGRAM_WEBHOOK_URL` with the exact path, and `TELEGRAM_CONNECT_CODE_TTL_MINUTES`. Restart the API.
3. From the repository root, register Telegram's incoming webhook:

   ```sh
   npm run telegram:set-webhook
   ```

   This calls Telegram's `setWebhook` with the secret-token header configuration and allows message updates only. The configured URL must route to the running backend without browser-session authentication.
4. In `/dashboard/billing`, select **Generate connect code**. Open the supplied deep link in Telegram, or send the displayed `/start <code>` command in a **private chat** with your bot. Codes are one-time, stored hashed, and expire after the configured lifetime (15 minutes by default). Confirm the link state on the Billing page.
5. Send `/stop` to the bot to unlink the chat. You can also disconnect it from the dashboard.

The server-side notification outbox queues and retries delivery rather than calling Telegram inside trade/payment transactions. The worker starts with the API and processes small batches approximately every 1.5 seconds; failed sends retry with backoff and eventually become `FAILED`. Supported notifications include trade opens/closes, confirmed deposits, low wallet balance, daily drawdown, panic activation, subscription renewals/payment failures, and successful linking. Users without a linked chat retain their dashboard/ledger data; undelivered Telegram messages are not shown as sent.

Telegram routes:

| Method | Route | Access |
|---|---|---|
| `POST` | `/api/v1/telegram/connect-code` | Session; generates the one-time private-chat code. |
| `DELETE` | `/api/v1/telegram/link` | Session; removes the current user's Telegram link. |
| `POST` | `/api/v1/notifications/telegram/webhook` | Telegram only; validates `X-Telegram-Bot-Api-Secret-Token`. |

## 5. Verification and production checklist

Automated tests use PGlite and a fake payment provider/Telegram client; they do not send real crypto, reach a live provider, or verify MT5 execution. Run:

```sh
# Repository root
npm test

# Next.js dashboard
cd web
npm run typecheck
npm run build
```

Before production:

- Apply migrations to the intended PostgreSQL database and confirm API startup passes its schema-readiness check.
- Replace all example secrets, set `NODE_ENV=production`, use managed secret storage, restrict network access, enable TLS, and back up the encryption key and database.
- Use live NOWPayments credentials and `https://api.nowpayments.io/v1` only after sandbox webhook tests, duplicate-callback checks, minimum/maximum amount checks, and wrong-network/error procedures are reviewed.
- Verify the callback URL is publicly reachable; inspect provider callback status and app logs without logging API keys, IPN secrets, full session tokens, or MT5 credentials.
- Configure Telegram webhook only after the production HTTPS route is ready; verify `/start` and `/stop` and a test notification in a private chat.
- Test deposits, subscription changes/renewals, insufficient-funds transitions, fee math, wallet-minimum recovery, and manual bot resume on test accounts. The integration suite is not a substitute for provider production verification.
- Follow the demo-account, ticker mapping, stop configuration, failed-execution acknowledgement, and latency limitations in [Phase 1](PHASE-1-SETUP.md), and the authentication/MT5/account risk guidance in [Phase 2](PHASE-2-SETUP.md) and [Phase 3](PHASE-3-SETUP.md).
