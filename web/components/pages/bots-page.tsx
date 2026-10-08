'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertOctagon, ArrowRight, Bot, Check, CircleAlert, CirclePause, Plus, Save, Shield, ShieldAlert, SlidersHorizontal, ToggleLeft, X } from 'lucide-react';
import { apiFetch, explainError, jsonBody } from '@/lib/api';
import type { Bot as TradingBot, Mt5Account } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeading } from '@/components/ui/page-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';

export function BotsPage() {
  const [bots, setBots] = useState<TradingBot[]>([]);
  const [accounts, setAccounts] = useState<Mt5Account[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingBot, setPendingBot] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [panicOpen, setPanicOpen] = useState(false);
  const [panicPending, setPanicPending] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ max_daily_drawdown: 250, max_lot_size: 0.1, news_filter_enabled: false, performance_fee_rate: 0.2 });
  const [newBotName, setNewBotName] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const [botData, accountData] = await Promise.all([
        apiFetch<{ bots: TradingBot[] }>('bots'),
        apiFetch<{ mt5_accounts: Mt5Account[] }>('mt5-accounts'),
      ]);
      setBots(botData.bots);
      setAccounts(accountData.mt5_accounts);
      setSelectedId((previous) => previous && botData.bots.some((bot) => bot.id === previous) ? previous : botData.bots[0]?.id || '');
      setError('');
    } catch (loadError) { setError(explainError(loadError)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const selected = bots.find((bot) => bot.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setDraft({ max_daily_drawdown: selected.max_daily_drawdown, max_lot_size: selected.max_lot_size, news_filter_enabled: selected.news_filter_enabled, performance_fee_rate: selected.performance_fee_rate });
  }, [selected]);

  async function saveRisk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const result = await apiFetch<{ bot: TradingBot }>(`bots/${selected.id}`, { method: 'PATCH', body: jsonBody({
        max_daily_drawdown: draft.max_daily_drawdown,
        max_lot_size: draft.max_lot_size,
        news_filter_enabled: draft.news_filter_enabled,
        performance_fee_rate: draft.performance_fee_rate,
      }) });
      setBots((current) => current.map((bot) => bot.id === result.bot.id ? result.bot : bot));
      toast({ kind: 'success', title: 'Risk profile updated', description: 'New webhook signals use these limits immediately.' });
    } catch (saveError) { setError(explainError(saveError)); }
    finally { setSaving(false); }
  }

  async function toggleBot(active: boolean) {
    if (!selected) return;
    setPendingBot(true);
    try {
      const result = await apiFetch<{ bot: TradingBot }>(`bots/${selected.id}`, { method: 'PATCH', body: jsonBody({ is_active: active }) });
      setBots((current) => current.map((bot) => bot.id === result.bot.id ? result.bot : bot));
      toast({ kind: 'success', title: active ? 'Bot resumed' : 'Bot paused', description: active ? 'New signals can be accepted again.' : 'New webhook signals will be rejected.' });
    } catch (toggleError) { toast({ kind: 'error', title: 'Could not update bot', description: explainError(toggleError) }); }
    finally { setPendingBot(false); }
  }

  async function createBot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPendingBot(true); setError('');
    try {
      const response = await apiFetch<{ bot: TradingBot }>('bots', { method: 'POST', body: jsonBody({
        mt5_account_id: newAccountId,
        bot_name: newBotName,
        max_daily_drawdown: 250,
        max_lot_size: 0.1,
        news_filter_enabled: false,
        performance_fee_rate: 0.2,
      }) });
      setBots((current) => [response.bot, ...current]);
      setSelectedId(response.bot.id); setCreateOpen(false); setNewBotName('');
      toast({ kind: 'success', title: 'Bot created', description: 'Review its USD loss cap and lot limit before enabling signals.' });
    } catch (createError) { setError(explainError(createError)); }
    finally { setPendingBot(false); }
  }

  async function triggerPanic() {
    if (!selected) return;
    setPanicPending(true);
    try {
      const response = await apiFetch<{ id: string; status: string; bridge_online: boolean; message: string }>(`bots/${selected.id}/panic`, { method: 'POST', body: jsonBody({}) });
      setPanicOpen(false);
      await refresh();
      toast({ kind: response.bridge_online ? 'success' : 'info', title: 'Panic switch armed', description: response.message });
    } catch (panicError) {
      toast({ kind: 'error', title: 'Panic request failed', description: explainError(panicError) });
    } finally { setPanicPending(false); }
  }

  const selectedAccount = useMemo(() => accounts.find((account) => account.id === selected?.mt5_account_id), [accounts, selected]);

  return (
    <div className="animate-rise">
      <PageHeading eyebrow="Risk engine" title="Bots & risk controls" description="Update validated bot limits and pause trading without touching the terminal. Loss cap is an absolute USD amount (the backend does not infer account equity percentages)." action={<Button onClick={() => { setNewAccountId(accounts.find((account) => account.is_active)?.id || ''); setCreateOpen(true); }} disabled={!accounts.some((account) => account.is_active)}><Plus size={15} /> New bot</Button>} />
      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] p-3 text-xs text-rose-100">{error}</div>}
      {loading ? <div className="grid gap-4 lg:grid-cols-[270px_1fr]"><Skeleton className="h-[360px]" /><Skeleton className="h-[500px]" /></div> : bots.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center py-16 text-center"><span className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] text-slate-400"><Bot size={21} /></span><h2 className="text-sm font-semibold text-white">No bots configured</h2><p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500">Create an MT5 account first, then add a bot with a clear daily USD loss cap and lot-size guard.</p><Button className="mt-5" onClick={() => setCreateOpen(true)} disabled={!accounts.some((account) => account.is_active)}><Plus size={14} /> Create first bot</Button></CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[270px_minmax(0,1fr)]">
          <Card className="h-fit overflow-hidden">
            <CardHeader className="pb-4"><div><CardTitle>Configured bots</CardTitle><CardDescription className="mt-1">{bots.length} risk profile{bots.length === 1 ? '' : 's'}</CardDescription></div><Badge>{bots.filter((bot) => bot.is_active).length} active</Badge></CardHeader>
            <div className="space-y-1 px-3 pb-3">{bots.map((bot) => {
              const active = selectedId === bot.id;
              const account = accounts.find((row) => row.id === bot.mt5_account_id);
              return <button key={bot.id} onClick={() => setSelectedId(bot.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${active ? 'bg-emerald-300/[0.08] ring-1 ring-emerald-300/10' : 'hover:bg-white/[0.035]'}`}><span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-emerald-300/[0.12] text-emerald-200' : 'bg-white/[0.035] text-slate-500'}`}><Bot size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{bot.bot_name}</span><span className="mt-1 block truncate text-[9px] text-slate-600">{account?.broker_server || 'MT5 account'}</span></span><span className={`size-1.5 rounded-full ${bot.is_active ? 'bg-emerald-300' : 'bg-slate-600'}`} /></button>;
            })}</div>
            <div className="border-t border-white/[0.05] p-3"><Link href="/dashboard/accounts" className="flex items-center gap-2 rounded-lg px-2 py-2 text-[10px] font-medium text-slate-500 transition hover:text-emerald-200"><SlidersHorizontal size={13} /> Manage connected accounts <ArrowRight size={12} className="ml-auto" /></Link></div>
          </Card>

          {selected && <div className="space-y-4">
            <Card>
              <CardHeader className="pb-5">
                <div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">{selected.bot_name}</CardTitle><Badge tone={selected.is_active ? 'green' : 'neutral'}>{selected.is_active ? 'Accepting signals' : 'Paused'}</Badge></div><CardDescription className="mt-1.5">Attached to {selectedAccount?.broker_server || 'MT5 account'} · login {selectedAccount?.account_number || '—'}</CardDescription></div>
                <div className="flex items-center gap-2"><Switch checked={selected.is_active} disabled={pendingBot} onCheckedChange={(checked) => void toggleBot(checked)} aria-label="Enable bot" /><span className="min-w-[42px] text-right text-[10px] text-slate-500">{selected.is_active ? 'Live' : 'Paused'}</span></div>
              </CardHeader>
            </Card>

            <form onSubmit={saveRisk}>
              <Card>
                <CardHeader className="pb-4"><div><CardTitle>Risk parameters</CardTitle><CardDescription className="mt-1">Applied server-side before a signal can enter the execution queue.</CardDescription></div><div className="flex size-8 items-center justify-center rounded-lg bg-emerald-300/[0.07] text-emerald-200"><Shield size={15} /></div></CardHeader>
                <CardContent className="space-y-7">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div><Label htmlFor="max-drawdown">Max daily drawdown (USD)</Label><div className="relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-600">$</span><Input id="max-drawdown" type="number" min="1" max="1000000" step="1" className="pl-8" value={draft.max_daily_drawdown} onChange={(event) => setDraft((current) => ({ ...current, max_daily_drawdown: Number(event.target.value) }))} required /></div><input aria-label="Daily USD drawdown limit" type="range" min="50" max="2000" step="25" value={Math.min(2000, Math.max(50, draft.max_daily_drawdown))} onChange={(event) => setDraft((current) => ({ ...current, max_daily_drawdown: Number(event.target.value) }))} className="risk-range mt-4 w-full" /><div className="mt-1 flex justify-between text-[9px] text-slate-600"><span>$50</span><span>$2,000+</span></div><p className="mt-2 text-[10px] leading-relaxed text-slate-600">Absolute realized net USD loss since 00:00 UTC. Not a percent of MT5 equity; unrealized loss is not included.</p></div>
                    <div><Label htmlFor="max-lot">Max lot size per signal</Label><Input id="max-lot" type="number" min="0.01" max="100" step="0.01" value={draft.max_lot_size} onChange={(event) => setDraft((current) => ({ ...current, max_lot_size: Number(event.target.value) }))} required /><div className="mt-4 rounded-xl border border-white/[0.055] bg-white/[0.02] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold text-slate-300"><ShieldAlert size={13} className="text-amber-200" />Hard guard, not a suggestion</div><p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">Signals above this volume are rejected before the EA receives them. Broker volume steps are still checked in MT5.</p></div></div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="flex items-start justify-between gap-4 rounded-xl border border-white/[0.055] bg-white/[0.02] p-4"><div><p className="text-xs font-semibold text-slate-200">News filter</p><p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">Currently fails closed until a news-calendar provider is integrated.</p></div><Switch checked={draft.news_filter_enabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, news_filter_enabled: checked }))} aria-label="Enable news filter" /></div>
                    <div><Label htmlFor="fee-rate">Performance fee rate</Label><div className="relative"><Input id="fee-rate" type="number" min="0" max="1" step="0.01" value={draft.performance_fee_rate} onChange={(event) => setDraft((current) => ({ ...current, performance_fee_rate: Number(event.target.value) }))} required /><span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-600">0–1</span></div><p className="mt-1.5 text-[10px] text-slate-600">For example, 0.20 means 20% of positive realized USD on a close.</p></div>
                  </div>
                  <div className="flex flex-col gap-3 border-t border-white/[0.05] pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-[10px] text-slate-600">Changes affect future signals. Existing claimed orders are not recalled.</p><Button type="submit" disabled={saving}><Save size={14} />{saving ? 'Saving…' : 'Save risk settings'}</Button></div>
                </CardContent>
              </Card>
            </form>

            <Card className="border-rose-300/10 bg-rose-950/[0.12]">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-rose-300/15 bg-rose-300/[0.06] text-rose-200"><AlertOctagon size={17} /></span><div><p className="text-sm font-semibold text-rose-100">Emergency panic switch</p><p className="mt-1 max-w-xl text-[10px] leading-relaxed text-rose-100/55">Pauses every bot on this MT5 account, cancels queued signals, asks the EA to close positions matching its magic number, then removes the EA after successful acknowledgement.</p></div></div><Button variant="danger" onClick={() => setPanicOpen(true)}><AlertOctagon size={14} /> Panic account</Button></CardContent>
            </Card>
          </div>}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>Create a bot</DialogTitle><DialogDescription>Every bot is linked to one MT5 bridge account and has its own server-side risk limits.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={createBot}><div><Label htmlFor="bot-name">Bot name</Label><Input id="bot-name" required maxLength={64} value={newBotName} onChange={(event) => setNewBotName(event.target.value)} placeholder="EURUSD breakout demo" /></div><div><Label htmlFor="bot-account">MT5 account</Label><select id="bot-account" required value={newAccountId} onChange={(event) => setNewAccountId(event.target.value)} className="field h-11 w-full rounded-xl border border-white/[0.09] bg-[#09121d] px-3.5 text-sm text-slate-100"><option value="">Choose an active account</option>{accounts.filter((account) => account.is_active).map((account) => <option key={account.id} value={account.id}>{account.broker_server} · {account.account_number}</option>)}</select></div><div className="rounded-xl border border-white/[0.055] bg-white/[0.02] p-3 text-[10px] leading-relaxed text-slate-500">Default limits: $250 daily realized USD drawdown · 0.10 lots max · news filter off. Review them after creation.</div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" disabled={pendingBot || !newAccountId}>{pendingBot ? 'Creating…' : 'Create bot'} <ArrowRight size={14} /></Button></div></form></DialogContent></Dialog>

      <Dialog open={panicOpen} onOpenChange={setPanicOpen}><DialogContent className="border-rose-300/15"><DialogHeader><DialogTitle className="flex items-center gap-2 text-rose-100"><AlertOctagon size={18} className="text-rose-300" /> Confirm emergency stop</DialogTitle><DialogDescription>This action applies to every bot on <span className="font-medium text-slate-200">{selectedAccount?.broker_server || 'this MT5 account'}</span>. A claimed broker order cannot be recalled.</DialogDescription></DialogHeader><div className="mb-5 space-y-2 rounded-xl border border-rose-300/10 bg-rose-300/[0.035] p-4 text-xs text-rose-100/75"><p>• Pause all account bots and reject new webhook orders.</p><p>• Cancel queued, unclaimed orders.</p><p>• If the EA is online, close open positions with its configured magic number and remove it from the chart.</p><p>• If offline, the close command waits for the EA to reconnect. The terminal may reject a close.</p></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPanicOpen(false)}>Cancel</Button><Button variant="danger" disabled={panicPending} onClick={() => void triggerPanic()}>{panicPending ? 'Sending…' : 'Pause & close managed positions'}</Button></div></DialogContent></Dialog>
    </div>
  );
}
