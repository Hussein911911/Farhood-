# Phase 2 setup: PostgreSQL, user sessions, API keys, and MT5

This phase replaces the single mock webhook secret and local SQLite command queue with PostgreSQL-backed tenant data and a per-MT5-account bridge credential. **Use a demo terminal/account only.**

## 1. Requirements

- Node.js **20.18+** and npm.
- PostgreSQL **14+**, or a Supabase PostgreSQL database.
- MetaTrader 5 desktop on the computer running the EA.
- TradingView webhooks need a public HTTPS URL; use a managed HTTPS endpoint or a temporary development tunnel.

For a local PostgreSQL install, create a database (or use the database/credentials provided by Supabase). Example for a local PostgreSQL installation:

```sql
CREATE ROLE farhood_app LOGIN PASSWORD 'use-a-new-local-password';
CREATE DATABASE farhood_dev OWNER farhood_app;
```

Configure `.env` from the template:

```sh
cp .env.example .env
```

Set `DATABASE_URL` to your database. For Supabase, use its PostgreSQL connection URI and TLS-required mode, for example `...?sslmode=require`; choose the direct or session-mode connection because the bridge uses a dedicated `LISTEN/NOTIFY` session (transaction-mode poolers do not support it). Keep database credentials server-side; never put them in Pine Script or the browser.

Generate independent secrets. Run the command separately for `API_KEY_PEPPER` and `SESSION_PEPPER`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Use the first command's output for each pepper and the second command's output for `MT5_ENCRYPTION_KEY`. The AES key must decode to exactly 32 bytes. The `.env.example` values are **development-only** and production startup rejects them. Back up the AES key securely; encrypted MT5 investor passwords cannot be recovered without it.

Relevant settings:

```dotenv
DATABASE_URL=postgresql://farhood_app:your-local-password@localhost:5432/farhood_dev
API_KEY_PEPPER=<independent-random-hex-value>
SESSION_PEPPER=<different-independent-random-hex-value>
MT5_ENCRYPTION_KEY=<random-32-byte-base64-value>
MIN_WALLET_BALANCE_USD=0.01
MAX_LOT=100
MAX_PENDING_SIGNALS=10000
BRIDGE_POLL_WAIT_MS=20000
BRIDGE_LEASE_MS=60000
BRIDGE_STALE_MS=45000
SESSION_TTL_HOURS=24
```

Install, migrate, test, and start:

```sh
npm install
npm run db:migrate
npm test
npm start
```

Migrations are explicit and tracked in `schema_migrations`; server startup fails with a migration hint if the core schema is missing. The test suite applies the same PostgreSQL migration and repository queries against PGlite, so tests do not need a separately running PostgreSQL server. For deployment, still run `npm run db:migrate` against the actual target database before starting the app.

## 2. Register a user and create credentials

Register a user. Registration does **not** activate a paid subscription or fund the wallet:

```sh
curl -i -X POST http://127.0.0.1:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"trader@example.test","password":"use-a-long-unique-password-42"}'
```

Log in and copy `access_token` from the response. Passwords are hashed with scrypt; the opaque session token is HMAC-hashed in PostgreSQL and expires according to `SESSION_TTL_HOURS`.

```sh
curl -i -X POST http://127.0.0.1:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"trader@example.test","password":"use-a-long-unique-password-42"}'
```

Use `Authorization: Bearer <access_token>` for account, bot, API-key, subscription, and trade-log endpoints. Logout revokes the token:

```sh
curl -i -X POST http://127.0.0.1:3000/api/v1/auth/logout \
  -H 'Authorization: Bearer <access_token>'
```

## 3. Register the MT5 demo account and create a bot

Create an account record using the numeric MT5 login and exact broker server name. `investor_password` is optional and, when provided, is encrypted with AES-256-GCM before it reaches the database. It is not returned by read endpoints and the EA does not need it; the terminal itself must already be logged in.

```sh
curl -i -X POST http://127.0.0.1:3000/api/v1/mt5-accounts \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{"account_number":"12345678","broker_server":"Broker-Demo","investor_password":"optional-read-only-investor-password"}'
```

Copy the returned `id`, `bridge_id`, and **one-time** `bridge_key` securely. `bridge_id` is an account identifier; `bridge_key` is the per-account secret. The EA checks that its actual terminal login/server match the account record and only claims commands routed to that account. If a bridge secret is exposed, rotate it with `POST /api/v1/mt5-accounts/<id>/rotate-bridge-key` (rotation is refused while a command is claimed). Deactivate with `DELETE /api/v1/mt5-accounts/<id>`; queued commands are failed, and reactivation requires `POST /api/v1/mt5-accounts/<id>/activate`, which issues a fresh bridge credential.

Create a bot and attach it to that MT5 account:

```sh
curl -i -X POST http://127.0.0.1:3000/api/v1/bots \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{"mt5_account_id":"<mt5_account_uuid>","bot_name":"EURUSD demo","max_daily_drawdown":250,"max_lot_size":0.10,"news_filter_enabled":false,"performance_fee_rate":0.20}'
```

Create a TradingView key scoped to that bot. The full `secret_key` is returned **only once**:

```sh
curl -i -X POST http://127.0.0.1:3000/api/v1/api-keys \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{"label":"EURUSD TradingView alert","bot_id":"<bot_uuid>"}'
```

The secret belongs in the private TradingView alert/script inputs. List and revoke keys through `/api/v1/api-keys`; hashes and full key values are never returned by list endpoints.

## 4. Provision a local demo subscription and wallet

A new user has no active subscription and a `$0` wallet by design. Production subscription state and wallet funding must come from a trusted billing/admin integration; this project does not let a user self-activate or mint wallet funds.

For local development only, provision the registered user with an active demo plan and balance. Use the user UUID returned from registration:

```sh
npm run demo:provision -- <user-uuid> PRO 100.00
```

This command is disabled when `NODE_ENV=production`. It updates the user's current tier/balance, cancels any prior live demo subscription, and inserts a new active subscription. Do not use it as a production billing interface.

## 5. Attach the MT5 bridge EA

1. In MT5 choose **File → Open Data Folder** and copy `mt5/TradingViewBridgeEA.mq5` into `MQL5/Experts/`.
2. Open MetaEditor, compile with **F7**, and attach the EA to a chart on the same demo terminal/account you registered.
3. In MT5 **Tools → Options → Expert Advisors**, enable **Allow WebRequest for listed URL** and add `http://127.0.0.1:3000`. Enable the terminal's **Algo Trading** button and allow automated trading in the EA's Common tab.
4. Set EA inputs from the MT5 account response:
   - `InpBaseUrl`: `http://127.0.0.1:3000`
   - `InpExpectedAccountNumber`: the account number stored in the database
   - `InpExpectedBrokerServer`: the exact broker server string
   - `InpBridgeId` and `InpBridgeKey`: the credentials returned once when creating the MT5 account
   - `InpMagic`: keep the default or assign a dedicated positive number
   - `InpAllowLiveAccount`: leave **false** for demo tests. The EA refuses non-demo account types unless this explicit opt-in is changed.
   - Keep `InpServerWaitMs=20000` and `InpHttpTimeoutMs=30000` initially.
5. Confirm the terminal is connected, broker symbols are in Market Watch, and the **Experts** tab reports successful polling.

The account-specific bridge key is different from the user's TradingView API key. Do not put `bridge_key` in Pine Script. A `CLOSE` command only closes positions for that MT5 symbol and the EA's `InpMagic` value.

## 6. Send a direct webhook test

If your API key is scoped to the bot, `bot_id` can be omitted. Otherwise add the bot UUID to the JSON. Replace the key with the one-time user API key from `POST /api/v1/api-keys`:

```sh
curl -i -X POST http://127.0.0.1:3000/api/v1/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "secret_key":"<user-api-key>",
    "signal_id":"manual-demo-001",
    "action":"BUY",
    "symbol":"EURUSD",
    "lot":0.01,
    "stop_loss":30,
    "take_profit":60,
    "stop_loss_type":"pips",
    "take_profit_type":"pips"
  }'
```

With an active subscription, wallet balance at/above the configured minimum, active bot/account, and a valid lot, expect `202 Accepted`. The Node log reports `webhook_accepted`; the EA sends the command and result, then the server logs `mt5_execution_confirmed` or `mt5_execution_failed` with `execution_latency_ms` and retcode. Verify actual trades/stops in the demo terminal.

A close signal example:

```sh
curl -i -X POST http://127.0.0.1:3000/api/v1/webhook \
  -H 'Content-Type: application/json' \
  -d '{"secret_key":"<user-api-key>","signal_id":"manual-demo-close-001","action":"CLOSE","symbol":"EURUSD"}'
```

Webhook response behavior:

- `202`: new command durably queued.
- `200`: duplicate `signal_id` with exactly the same normalized signal.
- `401`: unknown, revoked, or missing API key.
- `402`: wallet below `MIN_WALLET_BALANCE_USD`.
- `403`: no current subscription, inactive bot/account, lot/drawdown violation, or API-key bot-scope mismatch.
- `409`: same user re-used a `signal_id` with different trade parameters.
- `503`: queue at capacity, or a bot requires the news filter but no news provider is wired in. This is fail-closed.

## 7. Configure TradingView alerts

Use [`pine/TradingView-MT5-Bridge.pine`](../pine/TradingView-MT5-Bridge.pine) in TradingView's Pine Editor. Set **User API key** to the key from `POST /api/v1/api-keys`. If the key is not bot-scoped, set the bot UUID input or ensure the user has exactly one active bot. Configure a demo lot and stops appropriate for the symbol.

Create an alert with condition **“TradingView → MT5 Demo Bridge (example)” → “Any alert() function call”**. Set the webhook URL to:

```text
https://YOUR_PUBLIC_HOST/api/v1/webhook
```

`alert()` formats the JSON itself; leave the alert message template alone. For local development, a tunnel can forward HTTPS to the local listener:

```sh
cloudflared tunnel --url http://127.0.0.1:3000
```

Use the generated HTTPS hostname in TradingView. Keep the Node service and tunnel process running. For a persistent deployment, use a managed tunnel or HTTPS reverse proxy, access restrictions, firewall rules, and secret rotation. Do not expose PostgreSQL or the MT5 bridge key to TradingView.

The sample strategy sends `CLOSE` before a reversal entry and uses long-polling to avoid fixed poll delay. The latency metric starts when the webhook reaches Node; it does not include TradingView's internet delivery time. `<100 ms` end-to-end is not guaranteed.

## 8. Schema, risk, and fee behavior

Migration `001_phase2_core.sql` creates:

- `users`, `subscriptions`, `user_sessions`, `api_keys`
- `mt5_accounts`, `bots_config`
- `execution_commands` (persistent leased MT5 queue)
- `trade_logs` (one record per broker fill/command)

The user `subscription_tier` is a materialized current tier; a qualifying `ACTIVE`/unexpired `TRIAL` subscription must also exist and match the tier. Subscription payment lifecycle is intentionally external to this phase.

`max_daily_drawdown` is compared with the bot's realized **net USD P/L since 00:00 UTC**. New `BUY`/`SELL` signals are blocked once drawdown reaches its configured limit. This is not an intraday equity monitor and cannot see unrealized floating loss. If `news_filter_enabled` is true, commands are rejected until an actual news-calendar provider is integrated.

The EA reports deal P/L in its MT5 account currency. For `CLOSE` fills denominated in USD, the server deducts `min(wallet_balance, max(profit_loss, 0) * performance_fee_rate)` in the same PostgreSQL transaction that records the trade. Opening fills are logged with zero realized P/L/fee. Non-USD P/L is logged with its currency but is not converted or charged; use USD demo accounts for fee verification.

## 9. Automated tests and troubleshooting

```sh
npm test
```

The integration suite executes the SQL migration and exercises session creation, encrypted MT5 account storage, one-time API-key hashing, webhook authorization, subscription/wallet rejection, bot lot limits, account-specific command polling, trade-log recording, and fee deduction against PGlite.

Common issues:

- `npm start` says schema missing → set `DATABASE_URL`, then run `npm run db:migrate`.
- Webhook `401` → use the **user API key**, not the EA bridge key; confirm it has not been revoked.
- Webhook `403`/`402` → inspect subscription state, `users.subscription_tier`, wallet balance, selected bot/account, and bot risk limits.
- EA repeatedly gets HTTP `401` → its `InpBridgeId` / `InpBridgeKey` pair is wrong, rotated, or belongs to another MT5 account.
- EA refuses to initialize → account number/server mismatch or the terminal is not demo while `InpAllowLiveAccount=false`.
- EA WebRequest error → allow-list the exact base URL, enable Algo Trading, and check server/network connectivity.
- Broker retcode rejection → verify symbol mapping, volume step/minimum, SL/TP distance, market hours, margin, and `InpDeviationPoints`.
- Fees are zero on close → confirm the EA supplied a filled `deal`, positive `executed_lot`, positive USD `profit_loss`, and a nonzero bot fee rate.
