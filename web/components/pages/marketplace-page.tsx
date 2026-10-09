'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowRight, BarChart3, Check, Filter, Info, Plus, Search, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { apiFetch, explainError, jsonBody } from '@/lib/api';
import { strategies, type Strategy } from '@/lib/marketplace';
import type { Bot, Mt5Account } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeading } from '@/components/ui/page-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

export function MarketplacePage() {
  const [accounts, setAccounts] = useState<Mt5Account[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All strategies');
  const [selected, setSelected] = useState<Strategy | null>(null);
  const [accountId, setAccountId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    let mounted = true;
    Promise.all([
      apiFetch<{ mt5_accounts: Mt5Account[] }>('mt5-accounts'),
      apiFetch<{ bots: Bot[] }>('bots'),
    ]).then(([accountData, botData]) => {
      if (mounted) { setAccounts(accountData.mt5_accounts); setBots(botData.bots); setAccountId(accountData.mt5_accounts.find((account) => account.is_active)?.id || ''); }
    }).catch((loadError) => { if (mounted) setError(explainError(loadError)); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const categories = useMemo(() => ['All strategies', ...Array.from(new Set(strategies.map((strategy) => strategy.category)))], []);
  const visible = strategies.filter((strategy) => (category === 'All strategies' || strategy.category === category)
    && `${strategy.name} ${strategy.symbol} ${strategy.description}`.toLowerCase().includes(query.toLowerCase()));
  const attached = (strategy: Strategy) => bots.some((bot) => bot.bot_name === strategy.name);

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !accountId) return;
    setPending(true); setError('');
    try {
      const result = await apiFetch<{ bot: Bot }>('bots', { method: 'POST', body: jsonBody({
        mt5_account_id: accountId,
        bot_name: selected.name,
        max_daily_drawdown: selected.suggestedDrawdownUsd,
        max_lot_size: selected.suggestedLot,
        news_filter_enabled: false,
        performance_fee_rate: 0,
      }) });
      setBots((current) => [result.bot, ...current]);
      setSelected(null);
      toast({ kind: 'success', title: 'Strategy attached', description: 'Bot configuration created. No subscription payment was taken.' });
    } catch (attachError) { setError(explainError(attachError)); }
    finally { setPending(false); }
  }

  return (
    <div className="animate-rise">
      <PageHeading eyebrow="Strategy library · V1" title="Strategy marketplace" description="Explore documented strategy templates and attach a risk-configured bot to an MT5 account. Demo stats are illustrative; validate independently before enabling alerts." action={<Badge tone="amber"><Info size={11} /> Preview catalog</Badge>} />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <MarketplaceHighlight icon={BarChart3} title="Backtest details" detail="Compare example performance metrics" />
        <MarketplaceHighlight icon={ShieldCheck} title="Risk defaults" detail="Each template starts with conservative limits" />
        <MarketplaceHighlight icon={Sparkles} title="Attach in one step" detail="Create a bot config—no automatic billing" />
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-[320px]"><Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" /><Input aria-label="Search strategies" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or symbol" className="pl-10" /></div>
        <div className="flex items-center gap-2"><Filter size={14} className="text-slate-600" /><div className="flex flex-wrap gap-1.5">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`rounded-lg border px-3 py-2 text-[10px] font-medium transition ${category === item ? 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100' : 'border-white/[0.06] text-slate-500 hover:text-slate-200'}`}>{item}</button>)}</div></div>
      </div>

      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] p-3 text-xs text-rose-100">{error}</div>}
      <div className="grid gap-4 xl:grid-cols-3">
        {loading ? [1, 2, 3].map((item) => <Skeleton key={item} className="h-[385px]" />) : visible.map((strategy) => <StrategyCard key={strategy.slug} strategy={strategy} attached={attached(strategy)} hasActiveAccount={accounts.some((account) => account.is_active)} onSelect={() => { setSelected(strategy); setAccountId(accounts.find((account) => account.is_active)?.id || ''); }} />)}
      </div>
      {!loading && visible.length === 0 && <Card className="mt-4"><CardContent className="py-14 text-center text-xs text-slate-500">No strategy matches your filters.</CardContent></Card>}

      {!loading && accounts.filter((account) => account.is_active).length === 0 && <Card className="mt-6 border-amber-300/10 bg-amber-300/[0.025]"><CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-slate-100">Connect an MT5 account to attach a strategy</p><p className="mt-1 text-xs text-slate-500">Use a demo terminal. This does not add a paid strategy subscription.</p></div><ButtonLink href="/dashboard/accounts" size="sm">Add account <ArrowRight size={13} /></ButtonLink></CardContent></Card>}

      <div className="mt-7 flex flex-col gap-3 rounded-2xl border border-amber-300/10 bg-amber-300/[0.02] p-4 sm:flex-row sm:items-start"><Info size={15} className="mt-0.5 shrink-0 text-amber-200" /><div><p className="text-xs font-semibold text-amber-100/90">Performance figures are illustrative demonstration values</p><p className="mt-1 text-[10px] leading-relaxed text-amber-100/55">They are not independently audited or verified live results, do not guarantee future outcomes, and must be replaced with licensed, reproducible backtests before any commercial launch. Prices are preview only; no payment is collected.</p></div></div>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent><DialogHeader><DialogTitle>Attach {selected?.name}</DialogTitle><DialogDescription>This creates a bot configuration with the strategy’s suggested USD drawdown and lot limit. It is not a purchase or paid subscription.</DialogDescription></DialogHeader>{selected && <form onSubmit={attach} className="space-y-4"><div className="rounded-xl border border-white/[0.055] bg-white/[0.02] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{selected.name} <span className="text-slate-600">· {selected.symbol} / {selected.timeframe}</span></p><p className="mt-1 text-xs leading-relaxed text-slate-500">{selected.description}</p></div><Badge tone="neutral">${selected.monthlyPrice}/mo* preview</Badge></div><div className="mt-4 grid grid-cols-2 gap-2 text-[10px]"><span className="rounded-lg bg-black/20 p-2.5 text-slate-500">Daily USD cap <b className="float-right text-slate-200">${selected.suggestedDrawdownUsd}</b></span><span className="rounded-lg bg-black/20 p-2.5 text-slate-500">Max lot <b className="float-right text-slate-200">{selected.suggestedLot}</b></span></div></div><div><Label htmlFor="attach-account">Attach to active MT5 account</Label><NativeSelect id="attach-account" required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Choose an active account</option>{accounts.filter((account) => account.is_active).map((account) => <option key={account.id} value={account.id}>{account.broker_server} · {account.account_number}</option>)}</NativeSelect></div><div className="rounded-xl border border-amber-300/10 bg-amber-300/[0.035] p-3 text-[10px] leading-relaxed text-amber-100/70">The new bot starts active, but it will not receive TradingView signals until you create a bot-scoped API key. Please review risk settings before adding alerts. No payment is taken.</div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button type="submit" disabled={pending || !accountId}>{pending ? 'Attaching…' : 'Subscribe & attach'} <ArrowRight size={14} /></Button></div><p className="text-center text-[9px] text-slate-600">*Preview price only · billing integration not configured</p></form>}</DialogContent></Dialog>
    </div>
  );
}

function MarketplaceHighlight({ icon: Icon, title, detail }: { icon: React.ElementType; title: string; detail: string }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-300/[0.055] text-emerald-200"><Icon size={16} /></span><div><p className="text-xs font-semibold text-slate-200">{title}</p><p className="mt-1 text-[10px] text-slate-600">{detail}</p></div></CardContent></Card>;
}

function StrategyCard({ strategy, attached, hasActiveAccount, onSelect }: { strategy: Strategy; attached: boolean; hasActiveAccount: boolean; onSelect: () => void }) {
  const topTint = strategy.accent === 'emerald' ? 'bg-emerald-300/[0.025]' : strategy.accent === 'violet' ? 'bg-violet-300/[0.025]' : 'bg-cyan-300/[0.025]';
  const stroke = strategy.accent === 'emerald' ? '#6ee7b7' : strategy.accent === 'violet' ? '#c4b5fd' : '#67e8f9';
  const sparkline = strategy.sparkline.map((value, index) => `${(index / (strategy.sparkline.length - 1)) * 100},${40 - value * 0.45}`).join(' ');
  return (
    <Card className="group overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-white/[0.13]">
      <div className={`relative h-[100px] overflow-hidden border-b border-white/[0.05] ${topTint}`}>
        <svg viewBox="0 0 100 44" preserveAspectRatio="none" className="absolute inset-0 h-full w-full"><defs><linearGradient id={`strategy-${strategy.slug}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity=".19" /><stop offset="100%" stopColor={stroke} stopOpacity="0" /></linearGradient></defs><polygon points={`0,44 ${sparkline} 100,44`} fill={`url(#strategy-${strategy.slug})`} /><polyline points={sparkline} fill="none" stroke={stroke} strokeWidth="1.3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <div className="absolute left-5 top-4 flex items-center gap-2"><Badge tone={strategy.accent === 'emerald' ? 'green' : strategy.accent === 'violet' ? 'violet' : 'blue'}>{strategy.category}</Badge><Badge>Illustrative backtest</Badge></div>
        <div className="absolute bottom-3 right-4 font-mono text-[9px] text-slate-600">{strategy.symbol} · {strategy.timeframe}</div>
      </div>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold tracking-tight text-white">{strategy.name}</h3><p className="mt-1.5 min-h-10 text-[11px] leading-relaxed text-slate-500">{strategy.description}</p></div><Badge tone="neutral">{strategy.risk}</Badge></div>
        <div className="my-4 grid grid-cols-3 divide-x divide-white/[0.06] rounded-xl border border-white/[0.05] bg-white/[0.015] py-3"><Metric label="Win rate" value={`${strategy.winRate}%`} /><Metric label="Profit factor" value={strategy.profitFactor.toFixed(2)} /><Metric label="Max drawdown" value={`${strategy.maxDrawdown}%`} /></div>
        <div className="flex items-end justify-between gap-4"><div><p className="text-[9px] font-semibold uppercase tracking-[.13em] text-slate-600">Preview price</p><p className="mt-1 text-lg font-semibold text-white">${strategy.monthlyPrice}<span className="text-[10px] font-normal text-slate-600"> / mo*</span></p></div>{attached ? <Badge tone="green"><Check size={11} /> Attached</Badge> : <Button size="sm" onClick={onSelect} disabled={!hasActiveAccount}>Subscribe & attach <ArrowRight size={13} /></Button>}</div>
        <p className="mt-4 border-t border-white/[0.045] pt-3 text-[9px] leading-relaxed text-slate-600">Past-performance metrics shown for interface preview only. No billing provider is connected.</p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="px-2 text-center"><p className="text-[8px] uppercase tracking-[.12em] text-slate-600">{label}</p><p className="mt-1.5 font-mono text-xs font-semibold text-slate-200">{value}</p></div>;
}
