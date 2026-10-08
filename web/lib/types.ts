export type Mt5Account = {
  id: string;
  user_id: string;
  account_number: string;
  broker_server: string;
  bridge_id: string;
  connection_status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR' | string;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
};

export type Bot = {
  id: string;
  user_id: string;
  mt5_account_id: string;
  bot_name: string;
  max_daily_drawdown: number;
  max_lot_size: number;
  news_filter_enabled: boolean;
  performance_fee_rate: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ApiKey = {
  id: string;
  bot_id: string | null;
  key_prefix: string;
  label: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
};

export type Subscription = {
  id: string;
  tier: 'BASIC' | 'PLUS' | 'PRO' | string;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED' | string;
  starts_at: string;
  ends_at: string | null;
  provider: string | null;
  created_at: string;
};

export type Position = {
  ticket: string;
  mt5_account_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  open_price: number;
  current_pnl: number;
  pnl_currency: string;
  magic_number: string;
  opened_at: string;
  synced_at: string;
};

export type TradeLog = {
  id: string;
  user_id: string;
  bot_id: string;
  command_id: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'CLOSE' | 'PANIC' | string;
  lot: number;
  profit_loss: number;
  profit_loss_currency: string;
  performance_fee_deducted: number;
  execution_price: number | null;
  broker_order_id: string | null;
  broker_deal_id: string | null;
  broker_retcode: number | null;
  created_at: string;
};

export type DashboardOverview = {
  user: {
    id: string;
    email: string;
    subscription_tier: string;
    wallet_balance: number;
    created_at: string;
  };
  subscription: Subscription | null;
  accounts: Mt5Account[];
  bots: Bot[];
  positions: Position[];
  metrics: {
    total_trades_executed: number;
    winning_trades: number;
    losing_trades: number;
    open_positions: number;
    active_pnl_by_currency: Record<string, number>;
    realized_pnl_by_currency: Record<string, number>;
  };
  recent_trade_logs: TradeLog[];
};

export type ApiErrorPayload = { error?: string; message?: string };
