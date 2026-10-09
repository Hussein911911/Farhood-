CREATE TYPE subscription_tier AS ENUM ('BASIC', 'PLUS', 'PRO');
CREATE TYPE subscription_status AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
CREATE TYPE mt5_connection_status AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR');
CREATE TYPE trade_action AS ENUM ('BUY', 'SELL', 'CLOSE');
CREATE TYPE execution_status AS ENUM ('QUEUED', 'CLAIMED', 'EXECUTED', 'FAILED');

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  subscription_tier subscription_tier NOT NULL DEFAULT 'BASIC',
  wallet_balance NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier subscription_tier NOT NULL,
  status subscription_status NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  provider TEXT,
  provider_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX idx_subscriptions_user_period ON subscriptions(user_id, starts_at DESC, ends_at);
CREATE UNIQUE INDEX idx_subscriptions_one_live_per_user
  ON subscriptions(user_id) WHERE status IN ('TRIAL', 'ACTIVE');

CREATE TABLE api_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_key_hash CHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(16) NOT NULL,
  label VARCHAR(64) NOT NULL DEFAULT 'TradingView',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX idx_api_keys_user_active ON api_keys(user_id, is_active);

CREATE TABLE mt5_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_number VARCHAR(32) NOT NULL,
  broker_server VARCHAR(128) NOT NULL,
  investor_password_encrypted BYTEA,
  bridge_id VARCHAR(64) NOT NULL UNIQUE,
  bridge_key_hash CHAR(64) NOT NULL UNIQUE,
  connection_status mt5_connection_status NOT NULL DEFAULT 'DISCONNECTED',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, broker_server, account_number),
  UNIQUE (id, user_id)
);
CREATE INDEX idx_mt5_accounts_user_active ON mt5_accounts(user_id, is_active);

CREATE TABLE bots_config (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mt5_account_id UUID NOT NULL,
  bot_name VARCHAR(64) NOT NULL,
  max_daily_drawdown NUMERIC(14, 2) NOT NULL CHECK (max_daily_drawdown > 0),
  max_lot_size NUMERIC(12, 4) NOT NULL CHECK (max_lot_size > 0),
  news_filter_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  performance_fee_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.2000
    CHECK (performance_fee_rate >= 0 AND performance_fee_rate <= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (mt5_account_id, user_id) REFERENCES mt5_accounts(id, user_id) ON DELETE RESTRICT,
  UNIQUE (id, user_id)
);
CREATE INDEX idx_bots_config_user_active ON bots_config(user_id, is_active);
CREATE INDEX idx_bots_config_mt5_account ON bots_config(mt5_account_id, is_active);

ALTER TABLE api_keys ADD COLUMN bot_id UUID;
ALTER TABLE api_keys
  ADD CONSTRAINT fk_api_keys_bot_owner
  FOREIGN KEY (bot_id, user_id) REFERENCES bots_config(id, user_id) ON DELETE CASCADE;
CREATE INDEX idx_api_keys_bot ON api_keys(bot_id) WHERE bot_id IS NOT NULL;

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_user_sessions_user_live ON user_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE execution_commands (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
  bot_id UUID NOT NULL,
  mt5_account_id UUID NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  action trade_action NOT NULL,
  source_symbol VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  lot NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (lot >= 0),
  stop_loss NUMERIC(20, 8),
  take_profit NUMERIC(20, 8),
  stop_loss_type VARCHAR(8) NOT NULL DEFAULT 'price' CHECK (stop_loss_type IN ('price', 'pips')),
  take_profit_type VARCHAR(8) NOT NULL DEFAULT 'price' CHECK (take_profit_type IN ('price', 'pips')),
  performance_fee_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.2000
    CHECK (performance_fee_rate >= 0 AND performance_fee_rate <= 1),
  payload JSONB NOT NULL,
  status execution_status NOT NULL DEFAULT 'QUEUED',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_by VARCHAR(64),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  result_json JSONB,
  execution_latency_ms BIGINT,
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (bot_id, user_id) REFERENCES bots_config(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (mt5_account_id, user_id) REFERENCES mt5_accounts(id, user_id) ON DELETE RESTRICT
);
CREATE INDEX idx_execution_queue ON execution_commands(status, received_at, id);
CREATE INDEX idx_execution_lease ON execution_commands(status, lease_until);
CREATE INDEX idx_execution_user_recent ON execution_commands(user_id, received_at DESC);

CREATE TABLE trade_logs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bot_id UUID NOT NULL,
  command_id UUID NOT NULL UNIQUE REFERENCES execution_commands(id) ON DELETE RESTRICT,
  symbol VARCHAR(32) NOT NULL,
  action trade_action NOT NULL,
  lot NUMERIC(12, 4) NOT NULL CHECK (lot > 0),
  profit_loss NUMERIC(14, 2) NOT NULL DEFAULT 0,
  profit_loss_currency CHAR(3) NOT NULL DEFAULT 'USD',
  performance_fee_deducted NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (performance_fee_deducted >= 0),
  execution_price NUMERIC(20, 8),
  broker_order_id VARCHAR(32),
  broker_deal_id VARCHAR(32),
  broker_retcode INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (bot_id, user_id) REFERENCES bots_config(id, user_id) ON DELETE RESTRICT
);
CREATE INDEX idx_trade_logs_user_recent ON trade_logs(user_id, created_at DESC);
CREATE INDEX idx_trade_logs_bot_day ON trade_logs(bot_id, created_at DESC);
