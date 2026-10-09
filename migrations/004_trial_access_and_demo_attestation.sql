-- Phase 5: one-time free demo trials, isolated non-cash allowance, and terminal mode attestation.
ALTER TABLE users
  ADD COLUMN demo_trial_credit_usd NUMERIC(14, 2) NOT NULL DEFAULT 0
    CHECK (demo_trial_credit_usd >= 0);

ALTER TABLE mt5_accounts
  ADD COLUMN reported_trade_mode VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (reported_trade_mode IN ('UNKNOWN', 'DEMO', 'CONTEST', 'REAL')),
  ADD COLUMN trade_mode_reported_at TIMESTAMPTZ;

ALTER TABLE execution_commands
  ADD COLUMN performance_fee_exempt BOOLEAN NOT NULL DEFAULT FALSE;

-- Keep fees opt-in while the operator's fee policy and terms are being decided:
-- remove the implicit 20% default and reset stored rates. Rates may be explicitly
-- configured again if and when the server-side feature is enabled.
ALTER TABLE bots_config ALTER COLUMN performance_fee_rate SET DEFAULT 0;
UPDATE bots_config SET performance_fee_rate = 0;
UPDATE execution_commands SET performance_fee_rate = 0
WHERE status IN ('QUEUED', 'CLAIMED');

-- Grant the current early-access users a fresh 15-day trial only if they have
-- never had a subscription. The real wallet remains untouched at $0.
UPDATE users
SET demo_trial_credit_usd = 10.00, updated_at = now()
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.user_id = users.id
);

INSERT INTO subscriptions
  (id, user_id, tier, status, starts_at, ends_at, provider, monthly_price_usd)
SELECT
  gen_random_uuid(), u.id, u.subscription_tier, 'TRIAL', now(), now() + interval '15 days', 'free_trial', 0
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.user_id = u.id
);
