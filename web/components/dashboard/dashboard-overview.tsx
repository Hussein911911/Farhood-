'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bot, Cable,
  CircleCheck, CircleHelp, Clock3, Coins, ExternalLink, Link2, Plus, RefreshCw,
  ShieldCheck, Signal, TrendingDown, TrendingUp, Wallet, Zap,
} from 'lucide-react';
import { apiFetch, explainError } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber, isBridgeOnline, relativeTime } from '@/lib/format';
import type { DashboardOverview } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeading } from '@/components/ui/page-heading';
import { Skeleton } from '@/components/ui/skeleton';

function EmptyRows({ icon: Icon, title, description, action }: { icon: React.ElementType; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[210px] flex-col items-center justify-center px-6 py-8 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-slate-500"><Icon size={18} /></div>
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function ConnectionDot({ online }: { online: boolean }) {
  return <span className={`relative flex size-2.5 ${online ? '' : ''}`}><span className={`absolute inline-flex size-full rounded-full opacity-60 ${online ? 'animate-ping bg-emerald-400' : 'bg-slate-600'}`} /><span className={`relative inline-flex size-2.5 rounded-full ${online ? 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,.7)]' : 'bg-slate-600'}`} /></span>;
}

function PnlChart({ data }: { data: number[] }) {
  if (data.length < 2) {
    return <div className="flex h-[176px] items-center justify-center rounded-xl border border-dashed border-white/[0.07] text-center text-xs text-slate-600">Completed USD trade history will appear here.</div>;
  }
  const width = 620;
  const height = 176;
  const pad = 8;
  const min = Math.min(0, ...data);
  const max = Math.max(0, ...data);
  const range = Math.max(1, max - min);
  const coords = data.map((value, index) => {
    const x = pad + (index / (data.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const polyline = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const fillPath = `${coords[0][0]},${height} ${polyline} ${coords[coords.length - 1][0]},${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-[176px] w-full overflow-visible" role="img" aria-label="Cumulative realized profit and loss from recent USD trade logs">
      <defs><linearGradient id="pnl-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6ee7b7" stopOpacity=".20" /><stop offset="100%" stopColor="#6ee7b7" stopOpacity="0" /></linearGradient></defs>
      {[0.25, 0.5, 0.75].map((position) => <line key={position} x1="0" x2={width} y1={height * position} y2={height * position} stroke="rgba(255,255,255,.07)" strokeDasharray="4 6" />)}
      <polygon points={fillPath} fill="url(#pnl-fill)" />
      <polyline points={polyline} fill="none" stroke="#6ee7b7" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {coords.length > 0 && <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="4" fill="#6ee7b7" stroke="#0d1724" strokeWidth="3" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function DashboardOverview() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiFetch<DashboardOverview>('dashboard/overview');
      setOverview(data);
      setError('');
    } catch (loadError) {
      setError(explainError(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async (quiet: boolean) => {
      if (!mounted) return;
      if (quiet) setRefreshing(true); else setLoading(true);
      try {
        const data = await apiFetch<DashboardOverview>('dashboard/overview');
        if (mounted) { setOverview(data); setError(''); }
      } catch (loadError) {
        if (mounted) setError(explainError(loadError));
      } finally {
        if (mounted) { setLoading(false); setRefreshing(false); }
      }
    };
    void run(false);
    const interval = window.setInterval(() => void run(true), 15000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, []);

  const cumulativeUsd = useMemo(() => {
    let cumulative = 0;
    const rows = [...(overview?.recent_trade_logs || [])].reverse().filter((trade) => trade.profit_loss_currency === 'USD');
    return rows.map((trade) => { cumulative += trade.profit_loss; return cumulative; });
  }, [overview?.recent_trade_logs]);

  const onlineAccounts = overview?.accounts.filter((account) => account.is_active && isBridgeOnline(account.last_seen_at, account.connection_status)).length ?? 0;
  const activePnlEntries = Object.entries(overview?.metrics.active_pnl_by_currency ?? {});
  const activePnlUsd = activePnlEntries.length === 1 ? activePnlEntries[0][1] : activePnlEntries.length === 0 ? 0 : null;
  const latestPositionSync = overview?.positions.reduce<string | null>((latest, position) => !latest || new Date(position.synced_at) > new Date(latest) ? position.synced_at : latest, null) ?? null;
  const positionSnapshotStale = Boolean(latestPositionSync && Date.now() - new Date(latestPositionSync).getTime() > 60000);
  const winDenominator = (overview?.metrics.winning_trades || 0) + (overview?.metrics.losing_trades || 0);
  const winRate = winDenominator ? Math.round((overview!.metrics.winning_trades / winDenominator) * 100) : null;
  const now = new Date();

  return (
    <div className="animate-rise">
      <PageHeading
        eyebrow="Trading operations · live workspace"
        title={overview ? `Good day, ${overview.user.email.split('@')[0]}` : 'Overview'}
        description="A clear view of your bridge health, account exposure, and execution activity."
        action={<Button variant="secondary" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh</Button>}
      />

      {error && (
        <div role="alert" className="mb-6 flex flex-col gap-3 rounded-2xl border border-rose-300/15 bg-rose-300/[0.055] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold text-rose-100">Couldn’t refresh workspace data</p><p className="mt-1 text-xs text-rose-100/65">{error}</p></div>
          <Button size="sm" variant="outline" onClick={() => void load(false)}>Try again</Button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard loading={loading} label="Active PnL" icon={TrendingUp} value={activePnlUsd === null ? 'Multiple' : formatCurrency(activePnlUsd)} hint={positionSnapshotStale ? 'Position snapshot is stale · verify MT5 terminal' : activePnlEntries.length > 1 ? activePnlEntries.map(([currency, amount]) => `${currency} ${formatNumber(amount)}`).join(' · ') : 'MT5-managed open positions'} tone={activePnlUsd === null ? 'neutral' : activePnlUsd >= 0 ? 'green' : 'red'} />
        <MetricCard loading={loading} label="Trade records" icon={Activity} value={formatNumber(overview?.metrics.total_trades_executed ?? 0, 0)} hint={winRate === null ? 'Executed fills recorded' : `${winRate}% positive realized fills`} tone="neutral" />
        <MetricCard loading={loading} label="Wallet credit" icon={Wallet} value={formatCurrency(overview?.user.wallet_balance ?? 0)} hint="USD · fees are deducted on eligible closes" tone="neutral" />
        <MetricCard loading={loading} label="Subscription" icon={ShieldCheck} value={overview?.subscription?.tier || overview?.user.subscription_tier || '—'} hint={overview?.subscription ? `${overview.subscription.status.toLowerCase()} · renewals managed externally` : 'No active plan on file'} tone={overview?.subscription ? 'green' : 'amber'} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div><CardTitle>Execution performance</CardTitle><CardDescription className="mt-1">Cumulative realized USD P&amp;L from your latest trade records</CardDescription></div>
            <Badge tone="blue"><Clock3 size={11} /> Last 8 fills</Badge>
          </CardHeader>
          <CardContent className="pb-5 pt-3 sm:pb-6"><PnlChart data={cumulativeUsd} /><div className="mt-3 flex items-center justify-between text-[10px] text-slate-600"><span>Historical records · not a forecast</span><span>{formatDate(now.toISOString(), { month: 'short', day: 'numeric' })}</span></div></CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div><CardTitle>MT5 bridge health</CardTitle><CardDescription className="mt-1">Heartbeat refreshes every 15 seconds</CardDescription></div>
            <span className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] ${onlineAccounts ? 'text-emerald-200' : 'text-slate-500'}`}><ConnectionDot online={onlineAccounts > 0} />{onlineAccounts ? 'Online' : 'Offline'}</span>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            {loading && !overview ? <BridgeSkeleton /> : overview?.accounts.length ? overview.accounts.slice(0, 3).map((account) => {
              const online = account.is_active && isBridgeOnline(account.last_seen_at, account.connection_status);
              return (
                <div key={account.id} className="flex items-center gap-3 rounded-xl border border-white/[0.055] bg-white/[0.02] p-3">
                  <div className={`flex size-9 items-center justify-center rounded-xl ${online ? 'bg-emerald-300/[0.08] text-emerald-200' : 'bg-white/[0.04] text-slate-500'}`}><Cable size={16} /></div>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-xs font-semibold text-slate-200">{account.broker_server}</p><Badge tone={online ? 'green' : 'neutral'} className="py-0.5">{online ? 'Online' : account.is_active ? 'Offline' : 'Paused'}</Badge></div><p className="mt-1 truncate text-[10px] text-slate-500">Login {account.account_number} · {relativeTime(account.last_seen_at)}</p></div>
                  <Link href="/dashboard/accounts" aria-label="Manage MT5 account"><ArrowUpRight size={15} className="text-slate-600 transition hover:text-emerald-200" /></Link>
                </div>
              );
            }) : <EmptyRows icon={Cable} title="No MT5 account connected" description="Add your demo login and run the bridge EA to start receiving a heartbeat." action={<ButtonLink href="/dashboard/accounts" size="sm">Add MT5 account <ArrowRight size={14} /></ButtonLink>} />}
            {overview?.accounts && overview.accounts.length > 3 && <Link href="/dashboard/accounts" className="block pt-1 text-center text-[11px] font-medium text-emerald-200 hover:text-emerald-100">View all {overview.accounts.length} accounts <ArrowRight size={12} className="ml-1 inline" /></Link>}
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.28fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-4"><div><CardTitle>Active positions</CardTitle><CardDescription className="mt-1">EA-managed exposure · latest MT5 snapshot</CardDescription></div><div className="flex items-center gap-2"><Badge tone="neutral">{overview?.metrics.open_positions ?? 0} open</Badge>{positionSnapshotStale && <Badge tone="amber">Stale</Badge>}</div></CardHeader>
          {overview?.positions.length ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead><tr className="border-y border-white/[0.055] text-[9px] uppercase tracking-[.14em] text-slate-600"><th className="px-5 py-3 font-semibold">Symbol</th><th className="px-4 py-3 font-semibold">Side</th><th className="px-4 py-3 font-semibold">Size</th><th className="px-4 py-3 font-semibold">Open price</th><th className="px-5 py-3 text-right font-semibold">Open P&amp;L</th></tr></thead><tbody>{overview.positions.slice(0, 6).map((position) => <tr key={`${position.mt5_account_id}-${position.ticket}`} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]"><td className="px-5 py-3.5"><div className="font-semibold text-slate-200">{position.symbol}</div><div className="mt-1 text-[9px] text-slate-600">#{position.ticket}</div></td><td className="px-4 py-3.5"><Badge tone={position.side === 'BUY' ? 'green' : 'red'}>{position.side}</Badge></td><td className="px-4 py-3.5 font-mono text-slate-300">{formatNumber(position.volume, 2)}</td><td className="px-4 py-3.5 font-mono text-slate-400">{formatNumber(position.open_price, 5)}</td><td className={`px-5 py-3.5 text-right font-mono font-semibold ${position.current_pnl >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{formatCurrency(position.current_pnl, position.pnl_currency)}</td></tr>)}</tbody></table></div>
          ) : loading ? <div className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : <EmptyRows icon={BarChart3} title="No open positions reported" description="Position snapshots come from your EA-managed MT5 magic number. Keep the EA connected to refresh this panel." />}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-4"><div><CardTitle>Recent executions</CardTitle><CardDescription className="mt-1">Latest fills confirmed by your MT5 bridge</CardDescription></div><Link href="/dashboard" className="text-[10px] font-semibold text-emerald-200 hover:text-white">See all</Link></CardHeader>
          {overview?.recent_trade_logs.length ? (
            <div className="divide-y divide-white/[0.04]">{overview.recent_trade_logs.slice(0, 5).map((trade) => <div key={trade.id} className="flex items-center gap-3 px-5 py-3.5"><div className={`flex size-8 items-center justify-center rounded-lg ${trade.action === 'BUY' ? 'bg-emerald-300/[0.08] text-emerald-200' : trade.action === 'SELL' ? 'bg-rose-300/[0.08] text-rose-200' : 'bg-slate-400/[0.08] text-slate-300'}`}>{trade.action === 'BUY' ? <ArrowUpRight size={14} /> : trade.action === 'SELL' ? <ArrowDownRight size={14} /> : <Activity size={14} />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-xs font-semibold text-slate-200">{trade.symbol}</p><span className="text-[9px] text-slate-600">{trade.action}</span></div><p className="mt-1 text-[10px] text-slate-500">{formatNumber(trade.lot, 2)} lot · {formatDate(trade.created_at, { year: undefined, month: 'short', day: 'numeric' })}</p></div><div className="text-right"><p className={`text-xs font-semibold ${trade.profit_loss > 0 ? 'text-emerald-200' : trade.profit_loss < 0 ? 'text-rose-200' : 'text-slate-300'}`}>{formatCurrency(trade.profit_loss, trade.profit_loss_currency)}</p><p className="mt-1 text-[9px] text-slate-600">fee {formatCurrency(trade.performance_fee_deducted)}</p></div></div>)}</div>
          ) : loading ? <div className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : <EmptyRows icon={Activity} title="No executions yet" description="Once a TradingView signal is confirmed by MT5, its fill and fee details will show up here." />}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader className="pb-3"><div><CardTitle>Control center</CardTitle><CardDescription className="mt-1">Shortcuts for your daily trading workflow</CardDescription></div><div className="flex size-8 items-center justify-center rounded-lg bg-cyan-300/[0.08] text-cyan-200"><Zap size={15} /></div></CardHeader>
          <CardContent className="grid gap-2 pt-2 sm:grid-cols-2">
            <QuickLink href="/dashboard/bots" icon={Bot} title="Configure risk" subtitle={`${overview?.bots.length ?? 0} bot${overview?.bots.length === 1 ? '' : 's'} · daily USD limits`} />
            <QuickLink href="/dashboard/security" icon={ShieldCheck} title="Webhook security" subtitle="Create or revoke API keys" />
            <QuickLink href="/dashboard/marketplace" icon={SparklesIcon} title="Explore strategies" subtitle="Attach a demo strategy" />
            <QuickLink href="/docs" icon={CircleHelp} title="Guided setup" subtitle="TradingView + MT5 walkthrough" />
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="flex h-full min-h-[176px] flex-col justify-between gap-7">
            <div className="flex items-start justify-between gap-5"><div><p className="eyebrow mb-2">Account confidence</p><h3 className="text-lg font-semibold tracking-tight text-white">Stay in control, not in a rush.</h3><p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500">Start in demo, keep position sizes small, and verify every mapped symbol and execution result.</p></div><div className="hidden size-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-200 sm:flex"><ShieldCheck size={21} /></div></div>
            <Link href="/docs" className="inline-flex items-center gap-2 text-[11px] font-semibold text-emerald-200 hover:text-emerald-100">Review the risk-first checklist <ExternalLink size={13} /></Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ loading, label, value, hint, icon: Icon, tone }: { loading: boolean; label: string; value: string; hint: string; icon: React.ElementType; tone: 'green' | 'red' | 'amber' | 'neutral' }) {
  const tint = tone === 'green' ? 'text-emerald-200' : tone === 'red' ? 'text-rose-200' : tone === 'amber' ? 'text-amber-200' : 'text-slate-200';
  return (
    <Card className="overflow-hidden"><CardContent className="p-5 sm:p-5">
      <div className="flex items-start justify-between"><span className="text-[10px] font-semibold uppercase tracking-[.15em] text-slate-500">{label}</span><span className="flex size-8 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-emerald-200"><Icon size={15} /></span></div>
      {loading ? <Skeleton className="mt-4 h-7 w-32" /> : <div className={`mt-4 text-[26px] font-semibold tracking-[-.04em] ${tint}`}>{value}</div>}
      <p className="mt-2 min-h-4 text-[10px] leading-relaxed text-slate-600">{loading ? 'Loading workspace…' : hint}</p>
    </CardContent></Card>
  );
}

function BridgeSkeleton() {
  return <div className="space-y-3"><Skeleton className="h-[57px]" /><Skeleton className="h-[57px]" /><Skeleton className="h-[57px]" /></div>;
}

function QuickLink({ href, icon: Icon, title, subtitle }: { href: string; icon: React.ElementType; title: string; subtitle: string }) {
  return <Link href={href} className="group flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 transition hover:border-emerald-300/15 hover:bg-emerald-300/[0.025]"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-slate-400 transition group-hover:text-emerald-200"><Icon size={15} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-200">{title}</span><span className="mt-1 block truncate text-[9px] text-slate-600">{subtitle}</span></span><ArrowRight size={13} className="text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-emerald-200" /></Link>;
}

function SparklesIcon(props: React.ComponentProps<typeof Coins>) {
  return <Coins {...props} />;
}
