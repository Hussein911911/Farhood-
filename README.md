# TradingView → MT5 SaaS Execution Core

Phase 2 added PostgreSQL persistence and tenant-aware access controls to the Phase 1 webhook/MT5 execution bridge. Phase 3 added the Next.js dashboard and Phase 4 adds USDT billing and Telegram notifications. PostgreSQL is the source of truth for users, sessions, subscriptions, wallet/deposit ledgers, keys, MT5 bridge accounts, bot risk settings, queued commands, trade logs, and notification delivery.

> **Demo-first software.** Compile the EA in MetaEditor and verify every order, stop, fee, and broker symbol on a demo terminal before connecting a funded account. No latency or trading outcome is guaranteed.

## Phase 2 features

- PostgreSQL migration at [`migrations/001_phase2_core.sql`](migrations/001_phase2_core.sql) and an advisory-lock migration runner.
- Password sessions using scrypt; opaque bearer tokens are HMAC-hashed in `user_sessions`.
- One-time TradingView API keys HMAC-hashed with a server pepper. Keys can be scoped to one bot and revoked.
- Per-account MT5 bridge IDs and one-time bridge keys; each EA can claim only commands assigned to its MT5 account.
- AES-256-GCM encryption for optional read-only MT5 investor passwords.
- Durable PostgreSQL execution queue with idempotency, row-locking/leases, per-user transaction boundaries, and account-keyed `LISTEN/NOTIFY` wakeups for cross-process long polls.
- New-entry webhook authorization checks active subscription, wallet minimum, active bot/account, bot lot cap, daily drawdown, and news-filter availability before queueing; risk-reducing closes remain possible when subscription/wallet guards fail, provided the MT5 account is active.
- Executed broker fills recorded in `trade_logs`; profitable USD close trades deduct a bot-configured performance fee atomically from the wallet.
- Authenticated APIs for sessions, keys, MT5 accounts, bot configuration, subscriptions, and trade-log retrieval.
- Postgres-compatible integration tests run against PGlite (an embedded PostgreSQL WASM runtime), without requiring Docker or a local PostgreSQL service for `npm test`.

## Phase 4 billing and alerts

- NOWPayments invoices for USDT on TRC20 and BEP20; signed callbacks credit a wallet only after provider status `FINISHED`, with per-event/per-deposit idempotency.
- Monthly wallet-funded plan upgrades and renewals, auditable wallet transaction history, profitable USD close-trade performance fees, and a configurable low-wallet guard.
- Private-chat Telegram account linking with single-use connect codes and queued/retried trade, wallet, subscription, and risk alerts.
- The Next.js `/dashboard/billing` page displays deposit address/QR, wallet ledger, subscriptions, and Telegram linking.

See [`docs/PHASE-4-SETUP.md`](docs/PHASE-4-SETUP.md) for provider secrets, migration, launch, webhook, Telegram, and test instructions.

## Quick start

Requires **Node.js 20.18+** and PostgreSQL 14+ (or Supabase PostgreSQL).

```sh
npm ci
npm --prefix web ci
cp .env.example .env
# Configure DATABASE_URL and replace all demo secrets in .env.
npm run db:migrate
npm run check
npm test
npm start
```

See **[Phase 2 database and end-to-end setup](docs/PHASE-2-SETUP.md)** for local PostgreSQL, account/bot/API-key creation, EA configuration, TradingView tunnel, and `curl` examples, then **[Phase 4 billing and Telegram setup](docs/PHASE-4-SETUP.md)** for wallet operations and launch configuration. The previous single-secret Phase 1 instructions are superseded by the Phase 2 guide.

### Important billing and risk semantics

- New registrations start with `BASIC`, a zero wallet, and **no active subscription**. Use the signed NOWPayments settlement flow and wallet-funded Billing actions to activate a plan; `scripts/provision-demo-subscription.js` remains local development tooling and refuses `NODE_ENV=production`.
- “Sufficient” means `wallet_balance >= MIN_WALLET_BALANCE_USD` (default `$5.00`). Low wallet pauses bots, fails queued entries, and blocks new `BUY`/`SELL` commands; risk-reducing `CLOSE` commands remain available when the MT5 account is active. A credit does not automatically resume bots. The webhook also checks bot lot and realized UTC-day drawdown. If `news_filter_enabled=true`, new entries fail closed with `503` until a news provider is integrated.
- Monthly subscription charges and profitable USD close-trade performance fees are recorded in the wallet ledger. MT5 reports P/L in the account's currency; fees and daily USD drawdown apply only to USD reports. Use USD-denominated demo accounts until an audited FX conversion service is added. Fees equal `max(profit_loss, 0) * performance_fee_rate`, capped at the available wallet balance so it cannot become negative.
- Sessions, API-key hashes, bridge-key hashes, and database credentials are never returned by list endpoints. Newly issued API and bridge secrets are returned once. Do not put them in source control or public TradingView scripts.
- Preserve and back up `MT5_ENCRYPTION_KEY`; losing it makes encrypted investor passwords unrecoverable. Key rotation requires decrypt/re-encrypt migration. The service only stores investor (read-only) passwords; it does not need the MT5 master trading password because the terminal is logged in locally.

## Main routes

| Method | Route | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | Public | Create a user (no subscription is granted) |
| `POST` | `/api/v1/auth/login` | Public | Create a session bearer token |
| `POST` | `/api/v1/auth/logout` | Session | Revoke current session |
| `POST`, `GET`, `DELETE` | `/api/v1/api-keys` | Session | Issue/list/revoke user API keys; secret shown once |
| `POST`, `GET`, `DELETE` | `/api/v1/mt5-accounts` | Session | Register/list/deactivate account bridge credentials |
| `POST` | `/api/v1/mt5-accounts/:id/rotate-bridge-key` | Session | Rotate per-account bridge credentials when no command is in flight |
| `POST` | `/api/v1/mt5-accounts/:id/activate` | Session | Reactivate a disabled account with fresh bridge credentials |
| `POST`, `GET`, `PATCH` | `/api/v1/bots` | Session | Create/list/update bot risk configuration |
| `POST` | `/api/v1/bots/:id/panic` | Session | Pause all account bots and queue priority EA-managed closes |
| `GET` | `/api/v1/dashboard/overview` | Session | Dashboard metrics, accounts, positions, and recent fills |
| `GET` | `/api/v1/subscriptions` | Session | View subscription history |
| `GET` | `/api/v1/billing/overview` | Session | Wallet, ledger, deposit, plan, and Telegram-link status |
| `POST` | `/api/v1/payments/create-deposit` | Session | Create a USDT TRC20/BEP20 deposit invoice |
| `POST` | `/api/v1/payments/webhook` | NOWPayments HMAC-SHA512 signature | Verify settlement and credit a wallet idempotently |
| `POST` | `/api/v1/subscriptions/upgrade` | Session | Charge wallet and activate a subscription tier |
| `POST` / `DELETE` | `/api/v1/telegram/connect-code`, `/api/v1/telegram/link` | Session | Link or unlink the user's Telegram chat |
| `POST` | `/api/v1/notifications/telegram/webhook` | Telegram secret-token header | Process one-time connect/stop commands |
| `GET` | `/api/v1/trade-logs` | Session | Paginated trade history |
| `POST` | `/api/v1/mt5/positions/sync` | Per-account bridge bearer key | Replace the EA-managed position snapshot |
| `POST` | `/api/v1/webhook` | User API key in `secret_key` | Validate subscription, wallet, bot and enqueue order |
| `GET` | `/api/v1/mt5/commands/next` | Per-account bridge bearer key | EA long-polls its own queue |
| `POST` | `/api/v1/mt5/commands/:id/result` | Per-account bridge bearer key | Confirm broker result and persist trade/fee |
| `GET` | `/healthz`, `/readyz` | Public | Liveness and database/bridge readiness |

The response statuses for webhook validation include `202` accepted, `200` duplicate signal, `401` invalid key, `402` insufficient wallet for new entries, `403` inactive subscription/risk policy for new entries, `409` reused idempotency key with different content, and `503` full queue or unavailable configured news provider. Risk-reducing closes have the subscription/wallet/drawdown exceptions described above.

## Phase 3 dashboard

The Next.js 16 App Router application in [`web/`](web/) adds a secure browser dashboard with cookie-backed sessions, MT5 account setup, API-key management, bot risk controls, EA position/P&L snapshots, an account-scoped panic switch, a demonstration strategy catalog, and an interactive onboarding guide at `/docs`.

Start the Express API from the repository root, then in another terminal:

```sh
cd web
npm install
cp .env.example .env.local
# Set BACKEND_API_URL to the server-side Express API origin.
npm run dev
```

Open <http://localhost:3001>. See [`docs/PHASE-3-SETUP.md`](docs/PHASE-3-SETUP.md) for dashboard deployment and feature boundaries and [`docs/PHASE-4-SETUP.md`](docs/PHASE-4-SETUP.md) for billing. The strategy catalog's stats/prices are illustrative, its marketplace checkout is not connected, and attaching a strategy only creates a bot configuration. Billing-page USDT deposits and wallet subscriptions use the Phase 4 payment integration. The Panic switch requires an online MT5 EA to execute and acknowledge closures; always verify directly in the terminal.
