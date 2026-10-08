-- Phase 4: crypto wallet deposits, wallet ledger, recurring plans, and Telegram notifications.
ALTER TABLE users ADD COLUMN low_wallet_alerted_at TIMESTAMPTZ;
ALTER TABLE subscriptions
  ADD COLUMN monthly_price_usd NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monthly_price_usd >= 0);
ALTER TABLE bots_config ALTER COLUMN performance_fee_rate SET DEFAULT 0.1000;

CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  transaction_type VARCHAR(32) NOT NULL CHECK (transaction_type IN (
    'OPENING_BALANCE', 'TOP_UP', 'PERFORMANCE_FEE', 'SUBSCRIPTION_CHARGE', 'SUBSCRIPTION_RENEWAL'
  )),
  amount_usd NUMERIC(14, 2) NOT NULL CHECK (amount_usd <> 0),
  balance_after NUMERIC(14, 2) NOT NULL CHECK (balance_after >= 0),
  reference_type VARCHAR(32) NOT NULL,
  reference_id VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(192) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_transactions_user_recent
  ON wallet_transactions(user_id, created_at DESC, id DESC);

CREATE TABLE payment_deposits (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider VARCHAR(32) NOT NULL DEFAULT 'nowpayments' CHECK (provider = 'nowpayments'),
  order_id VARCHAR(64) NOT NULL UNIQUE,
  provider_payment_id VARCHAR(128) UNIQUE,
  network VARCHAR(8) NOT NULL CHECK (network IN ('TRC20', 'BEP20')),
  pay_currency VARCHAR(24) NOT NULL,
  price_currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (price_currency = 'USD'),
  amount_usd NUMERIC(14, 2) NOT NULL CHECK (amount_usd > 0),
  pay_address VARCHAR(256),
  pay_amount NUMERIC(30, 12),
  amount_received NUMERIC(30, 12) NOT NULL DEFAULT 0,
  tx_hash VARCHAR(256),
  status VARCHAR(32) NOT NULL DEFAULT 'CREATING',
  expires_at TIMESTAMPTZ,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_deposits_user_recent ON payment_deposits(user_id, created_at DESC);
CREATE INDEX idx_payment_deposits_open ON payment_deposits(status, created_at)
  WHERE credited_at IS NULL;

CREATE TABLE payment_webhook_events (
  id UUID PRIMARY KEY,
  provider VARCHAR(32) NOT NULL CHECK (provider = 'nowpayments'),
  event_key CHAR(64) NOT NULL UNIQUE,
  deposit_id UUID REFERENCES payment_deposits(id) ON DELETE SET NULL,
  provider_payment_id VARCHAR(128),
  provider_status VARCHAR(32) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE telegram_links (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id VARCHAR(32) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE telegram_connect_codes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX idx_telegram_connect_codes_user_live
  ON telegram_connect_codes(user_id, expires_at) WHERE used_at IS NULL;
CREATE TABLE telegram_updates (
  update_id BIGINT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_outbox (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(192) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'SKIPPED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  last_error VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX idx_notification_outbox_ready
  ON notification_outbox(status, available_at, created_at)
  WHERE status IN ('QUEUED', 'SENDING');
CREATE INDEX idx_notification_outbox_user_recent
  ON notification_outbox(user_id, created_at DESC);
