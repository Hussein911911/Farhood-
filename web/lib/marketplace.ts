export type Strategy = {
  slug: string;
  name: string;
  category: string;
  symbol: string;
  timeframe: string;
  description: string;
  accent: 'emerald' | 'violet' | 'cyan';
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  monthlyPrice: number;
  suggestedLot: number;
  suggestedDrawdownUsd: number;
  feeRate: number;
  risk: 'Balanced' | 'Moderate' | 'Conservative';
  sparkline: number[];
};

// Demonstration catalog values only. Replace with independently verified backtests before sale.
export const strategies: Strategy[] = [
  {
    slug: 'london-pulse',
    name: 'London Pulse',
    category: 'Momentum',
    symbol: 'EURUSD',
    timeframe: '15m',
    description: 'A session-aware breakout template for liquid London open conditions.',
    accent: 'emerald',
    winRate: 64.2,
    profitFactor: 1.74,
    maxDrawdown: 8.6,
    monthlyPrice: 19,
    suggestedLot: 0.05,
    suggestedDrawdownUsd: 200,
    feeRate: 0.2,
    risk: 'Balanced',
    sparkline: [14, 18, 17, 27, 23, 33, 37, 34, 48, 51, 58, 67],
  },
  {
    slug: 'golden-hour',
    name: 'Golden Hour',
    category: 'Trend following',
    symbol: 'XAUUSD',
    timeframe: '30m',
    description: 'A slower trend-following setup designed for structured gold sessions.',
    accent: 'violet',
    winRate: 58.7,
    profitFactor: 1.52,
    maxDrawdown: 12.4,
    monthlyPrice: 29,
    suggestedLot: 0.02,
    suggestedDrawdownUsd: 300,
    feeRate: 0.2,
    risk: 'Moderate',
    sparkline: [14, 23, 19, 28, 26, 40, 35, 43, 51, 49, 60, 70],
  },
  {
    slug: 'quiet-range',
    name: 'Quiet Range',
    category: 'Mean reversion',
    symbol: 'GBPUSD',
    timeframe: '1h',
    description: 'A low-frequency range template with conservative default exposure.',
    accent: 'cyan',
    winRate: 67.1,
    profitFactor: 1.38,
    maxDrawdown: 6.2,
    monthlyPrice: 14,
    suggestedLot: 0.03,
    suggestedDrawdownUsd: 150,
    feeRate: 0.15,
    risk: 'Conservative',
    sparkline: [13, 20, 19, 24, 31, 30, 38, 37, 44, 50, 54, 62],
  },
];
