-- Phase 3 dashboard support: synced open positions and priority panic commands.
ALTER TYPE trade_action ADD VALUE 'PANIC';

ALTER TABLE execution_commands ALTER COLUMN api_key_id DROP NOT NULL;
ALTER TABLE execution_commands
  ADD COLUMN priority SMALLINT NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100);
CREATE INDEX idx_execution_queue_priority
  ON execution_commands(mt5_account_id, status, priority DESC, received_at, id);

CREATE TABLE mt5_positions (
  user_id UUID NOT NULL,
  mt5_account_id UUID NOT NULL,
  ticket VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  volume NUMERIC(12, 4) NOT NULL CHECK (volume > 0),
  open_price NUMERIC(20, 8) NOT NULL CHECK (open_price > 0),
  current_pnl NUMERIC(14, 2) NOT NULL DEFAULT 0,
  pnl_currency CHAR(3) NOT NULL DEFAULT 'USD',
  magic_number BIGINT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mt5_account_id, ticket),
  FOREIGN KEY (mt5_account_id, user_id) REFERENCES mt5_accounts(id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_mt5_positions_user_opened ON mt5_positions(user_id, opened_at DESC);
