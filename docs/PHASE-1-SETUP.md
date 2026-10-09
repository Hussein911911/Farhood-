# Phase 1 setup (superseded)

The Phase 1 local-secret/SQLite setup has been superseded by the PostgreSQL-backed Phase 2 architecture. Follow [`PHASE-2-SETUP.md`](PHASE-2-SETUP.md) for the current schema, migrations, session login, user API-key creation, per-account MT5 bridge credentials, webhook tests, and TradingView instructions.

The current EA no longer uses a global `BRIDGE_KEY`; it requires the `bridge_id` and one-time `bridge_key` returned by `POST /api/v1/mt5-accounts`. The current webhook `secret_key` is a user API key issued by `POST /api/v1/api-keys`.
