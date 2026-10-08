# Phase 3 setup — Farhood dashboard, marketplace, and onboarding

Phase 3 adds a responsive Next.js App Router dashboard alongside the Phase 2 Express/PostgreSQL API. The web app lives in `web/` and includes account onboarding, live bridge status, financial overview, API-key management, bot risk controls, a strategy catalog, and an interactive TradingView/MT5 guide.

> **Demo-first.** Run the full flow on an MT5 demo account. The marketplace metrics/prices are illustrative previews, billing is not connected, and neither trading results nor sub-100 ms end-to-end latency are guaranteed.

## 1. Requirements

- Node.js 20.18+ and npm.
- PostgreSQL 14+ or Supabase PostgreSQL for the backend.
- MetaTrader 5 desktop and a demo login for EA testing.
- A browser-accessible HTTPS endpoint for TradingView webhook alerts.

Keep the existing root `.env` for Express/PostgreSQL. Never expose that file, `DATABASE_URL`, API key peppers, AES encryption key, or MT5 bridge key to browser code.

## 2. Start the Phase 2 API

From the repository root:

```sh
npm install
cp .env.example .env
# Set DATABASE_URL and generate independent API_KEY_PEPPER,
# SESSION_PEPPER, and MT5_ENCRYPTION_KEY values.
npm run db:migrate
npm test
npm start
```

Migrations `001_phase2_core.sql` and `002_phase3_dashboard.sql` create the core schema and add dashboard position snapshots plus prioritized panic commands. The same integration suite applies the migrations through PGlite; use `npm run db:migrate` against your actual PostgreSQL database before starting the service.

The API normally listens on `http://127.0.0.1:3000`. The Next.js server calls the API server-to-server, so the browser does not need CORS access to the Express port.

## 3. Start the Next.js web app

In a second terminal:

```sh
cd web
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3001>. The `web/.env.example` contains:

```dotenv
BACKEND_API_URL=http://127.0.0.1:3000
```

`BACKEND_API_URL` is server-side only. For deployment, point it at the private/reachable origin of the Express API (for example, `https://api.example.com`) and deploy the Next app over HTTPS. Do not rename it with a `NEXT_PUBLIC_` prefix. The Next dev server binds to `0.0.0.0:3001` for preview/container use and allows Arena preview origins.

The browser calls only same-origin `/api/...` routes. Next.js proxies authenticated dashboard requests to Express and holds the opaque session token in a `Secure`-in-production, `HttpOnly`, `SameSite=Lax` cookie; the bearer token is not stored in localStorage or returned to client JavaScript. Mutation routes check request origin. Login, registration, and logout use dedicated Next route handlers.

### Production build

```sh
cd web
npm run typecheck
npm run build
npm run start
```

Configure `BACKEND_API_URL` in the Next server environment. Configure database and secrets in the Express service environment independently.

## 4. Dashboard features and API integration

| Web area | Backend integration |
|---|---|
| Login and registration | Next route handlers call `/api/v1/auth/login` and `/api/v1/auth/register`; the access token is converted to an HttpOnly cookie. |
| Overview | `/api/v1/dashboard/overview` returns wallet, current subscription, bot/account status, trade totals, recent trade logs, active positions, and P&amp;L grouped by currency. |
| MT5 accounts | `/api/v1/mt5-accounts`, key rotation, account deactivation, and reactivation; one-time bridge secrets are shown only in the creation/rotation response. |
| API keys | `/api/v1/api-keys` supports create/list/revoke. The new user API secret is displayed once and never retrieved from storage. |
| Bots and risk | `/api/v1/bots` supports create/list/update, including USD daily loss cap, max lot, news-filter setting, and pause/resume. |
| Panic switch | `POST /api/v1/bots/:id/panic` pauses every bot on that MT5 account, cancels queued commands, and queues a high-priority EA-managed close command. |
| Strategy catalog | V1 strategy cards create a bot config on the selected MT5 account. Catalog price labels are preview-only; no payment/subscription is activated. |
| Interactive docs | `/docs` includes progress checklists, a copyable Pine v5 sample, JSON alert payload, visual MT5/MetaEditor walkthrough, and demo verification steps. |

### Open positions and P&amp;L snapshots

The Phase 3 EA sends an authenticated `POST /api/v1/mt5/positions/sync` snapshot about every 15 seconds. The snapshot contains positions matching the EA's configured `InpMagic`, along with symbol, side, volume, entry price, floating P&amp;L plus swap, and account currency. The dashboard displays the latest snapshot; it is not a broker-side streaming feed. Only up to 100 managed positions are accepted per snapshot. Non-USD amounts are shown in their own currency and are not converted.

If an EA is disconnected or a snapshot is stale, refresh the dashboard and inspect the bridge heartbeat. Do not treat the dashboard snapshot as a substitute for the MT5 terminal or broker statement.

### Risk limits and panic behavior

The risk panel correctly labels `max_daily_drawdown` as an **absolute realized USD amount since 00:00 UTC**, not a percentage of account equity. The Phase 2 engine does not receive authoritative account equity and does not include floating drawdown in that guard. If the news filter is enabled, signals fail closed until a real news-calendar integration exists.

The panic request disables all bot configurations on the selected account, rejects future webhook signals for them, fails queued (unclaimed) commands, then queues a priority panic command. The EA closes positions that match its configured `InpMagic` across available symbols. It removes itself from the chart only after all managed positions are closed and the backend acknowledges the result. A claimed broker order cannot be recalled. If MT5 is offline, the panic remains queued; broker/terminal rejection is possible, so verify the account directly. Panic commands do not create synthetic trade-log fills.

## 5. Marketplace V1 boundaries

The built-in catalog data in `web/lib/marketplace.ts` is **demonstration content**: win rate, profit factor, drawdown, and monthly price values are not audited or independently verified. Replace them with licensed, reproducible backtest results and clear methodology before offering strategies commercially.

“Subscribe & attach” currently creates a bot configuration using the strategy's suggested risk defaults. It does not create a paid marketplace entitlement, start a recurring subscription, or charge a card. The platform's tier subscriptions and wallet remain provisioned by a trusted billing/admin integration. Do not expose client-side tier activation or wallet top-up endpoints.

## 6. First-run checklist

1. Register a user at `/register`, then sign in.
2. Use `/dashboard/accounts` to register the MT5 **demo** account and save its one-time `bridge_id` / `bridge_key` securely.
3. Compile `mt5/TradingViewBridgeEA.mq5` in MetaEditor and set the matching demo login, exact broker server, API base URL, bridge credentials, and `InpMagic`. Allow the API URL in MT5 WebRequest settings and enable Algo Trading.
4. Create a bot at `/dashboard/bots`. Review its USD drawdown and maximum lot. Keep news filtering off until a provider is configured.
5. Create a bot-scoped TradingView API key at `/dashboard/security`; copy the one-time user key into a private alert message/input.
6. Open `/docs` and follow the interactive steps. Send a small direct webhook test to the public HTTPS endpoint and confirm the broker fill and acknowledgement in MT5.
7. Confirm the dashboard bridge status, open-position snapshot, and trade-log/fee values against the demo terminal.

The Phase 1 end-to-end latency caveat still applies: TradingView delivery, internet routing, server queueing, MT5 terminal polling, and broker execution all add variable latency. An end-to-end result under 100 ms cannot be guaranteed.
