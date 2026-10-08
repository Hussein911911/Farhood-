'use client';

import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowRight, BadgeCheck, Check, Clock3, Copy, ExternalLink, RefreshCw, ShieldCheck, Wallet, XCircle } from 'lucide-react';
import { apiFetch, explainError, jsonBody } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeading } from '@/components/ui/page-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

type Deposit = {
  id: string;
  order_id: string;
  network: 'TRC20' | 'BEP20' | string;
  pay_currency: string;
  amount_usd: number;
  pay_address: string | null;
  pay_amount: number | null;
  amount_received: number;
  tx_hash: string | null;
  status: string;
  expires_at: string | null;
  credited_at: string | null;
  created_at: string;
};

type WalletTransaction = {
  id: string;
  transaction_type: string;
  amount_usd: number;
  balance_after: number;
  reference_type: string;
  reference_id: string;
  description: string;
  created_at: string;
};

type Plan = { tier: 'BASIC' | 'PLUS' | 'PRO'; monthly_price_usd: number };
type BillingOverview = {
  wallet_balance: number;
  subscription_tier: string;
  subscription: { id: string; tier: string; status: string; starts_at: string; ends_at: string | null; provider: string | null; monthly_price_usd: number } | null;
  deposits: Deposit[];
  wallet_transactions: WalletTransaction[];
  telegram_linked: boolean;
  telegram_connected_at: string | null;
  plans: Plan[];
  payments_enabled: boolean;
  payment_min_usd: number;
  payment_max_usd: number;
  min_wallet_balance_usd: number;
  telegram_enabled: boolean;
  telegram_bot_username: string | null;
};

type ConnectCode = { code: string; bot_username: string | null; deep_link: string | null; command: string; expires_at: string };

const terminalDepositStatuses = new Set(['FINISHED', 'FAILED', 'REFUNDED', 'EXPIRED']);

export function BillingPage() {
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('25.00');
  const [network, setNetwork] = useState<'TRC20' | 'BEP20'>('TRC20');
  const [activeDeposit, setActiveDeposit] = useState<Deposit | null>(null);
  const [connectCode, setConnectCode] = useState<ConnectCode | null>(null);
  const [submittingTier, setSubmittingTier] = useState<string | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const data = await apiFetch<BillingOverview>('billing/overview');
      setOverview(data);
      setError('');
    } catch (loadError) {
      setError(explainError(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!activeDeposit || terminalDepositStatuses.has(activeDeposit.status)) return;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const result = await apiFetch<{ deposit: Deposit }>(`payments/deposits/${activeDeposit.id}`);
        setActiveDeposit(result.deposit);
        if (result.deposit.status === 'FINISHED') {
          await refresh(true);
          toast({ kind: 'success', title: 'USDT deposit credited', description: `${formatCurrency(result.deposit.amount_usd)} was added to your wallet.` });
        }
      } catch {
        // Keep showing the address; a temporary status poll failure does not cancel a payment.
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    return () => window.clearInterval(timer);
  }, [activeDeposit?.id, activeDeposit?.status, refresh, toast]);

  async function createDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overview?.payments_enabled) return;
    setBusy(true); setError(''); setActiveDeposit(null);
    try {
      const result = await apiFetch<{ deposit: Deposit }>('payments/create-deposit', {
        method: 'POST',
        body: jsonBody({ amount_usd: Number(amount), network }),
      });
      setActiveDeposit(result.deposit);
      await refresh(true);
      toast({ kind: 'success', title: 'Deposit address created', description: `Send only USDT on ${network} to this address.` });
    } catch (createError) {
      setError(explainError(createError));
    } finally {
      setBusy(false);
    }
  }

  async function subscribe(tier: string) {
    setSubmittingTier(tier); setError('');
    try {
      await apiFetch('subscriptions/upgrade', { method: 'POST', body: jsonBody({ tier }) });
      await refresh(true);
      toast({ kind: 'success', title: `${tier} plan activated`, description: 'The monthly fee was debited from your wallet.' });
    } catch (upgradeError) {
      setError(explainError(upgradeError));
    } finally {
      setSubmittingTier(null);
    }
  }

  async function createTelegramCode() {
    setBusy(true); setError('');
    try {
      setConnectCode(await apiFetch<ConnectCode>('telegram/connect-code', { method: 'POST', body: '{}' }));
    } catch (connectError) {
      setError(explainError(connectError));
    } finally {
      setBusy(false);
    }
  }

  async function unlinkTelegram() {
    if (!window.confirm('Disconnect Farhood notifications from this Telegram account?')) return;
    setBusy(true);
    try {
      await apiFetch<void>('telegram/link', { method: 'DELETE' });
      setConnectCode(null);
      await refresh(true);
      toast({ kind: 'success', title: 'Telegram disconnected' });
    } catch (unlinkError) {
      setError(explainError(unlinkError));
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ kind: 'success', title: `${label} copied` });
    } catch {
      toast({ kind: 'error', title: 'Could not copy', description: 'Select and copy the text manually.' });
    }
  }

  const pendingDeposits = (overview?.deposits || []).filter((deposit) => !terminalDepositStatuses.has(deposit.status));
  const activeSubscription = overview?.subscription?.status === 'ACTIVE' || overview?.subscription?.status === 'TRIAL';

  return (
    <div className="animate-rise">
      <PageHeading
        eyebrow="Wallet · payments · access"
        title="Billing & wallet"
        description="Top up with USDT, review every wallet movement, and manage monthly plan renewals."
        action={<Button variant="secondary" onClick={() => void refresh(true)} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh</Button>}
      />

      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] p-3 text-xs text-rose-100">{error}</div>}

      <div className="mb-6 grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <Card className="overflow-hidden"><CardContent className="relative flex min-h-[190px] flex-col justify-between gap-6 p-6"><div className="absolute -right-8 -top-14 size-52 rounded-full bg-emerald-300/[0.05] blur-[48px]" /><div className="relative flex items-start justify-between"><div><p className="eyebrow mb-2">Available wallet balance</p>{loading ? <Skeleton className="h-9 w-36" /> : <h2 className="text-3xl font-semibold tracking-[-.05em] text-white">{formatCurrency(overview?.wallet_balance || 0)}</h2>}<p className="mt-2 text-xs text-slate-500">USD · trade fees and subscription charges appear in the ledger</p></div><span className="flex size-11 items-center justify-center rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.055] text-emerald-200"><Wallet size={19} /></span></div><div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-4"><span className="text-[10px] text-slate-500">Minimum balance to accept new entries</span><Badge tone={(overview?.wallet_balance || 0) >= (overview?.min_wallet_balance_usd || 5) ? 'green' : 'amber'}>{formatCurrency(overview?.min_wallet_balance_usd || 5)} required</Badge></div></CardContent></Card>

        <Card><CardHeader className="pb-3"><div><CardTitle>Top up with USDT</CardTitle><CardDescription className="mt-1">Powered by NOWPayments · TRC20 or BEP20</CardDescription></div><Badge tone={overview?.payments_enabled ? 'green' : 'amber'}>{overview?.payments_enabled ? 'Ready' : 'Not configured'}</Badge></CardHeader><CardContent className="pt-1"><form onSubmit={createDeposit} className="space-y-4"><div className="grid gap-3 sm:grid-cols-[1fr_.9fr]"><div><Label htmlFor="top-up-amount">Amount to credit (USD)</Label><Input id="top-up-amount" type="number" inputMode="decimal" min={overview?.payment_min_usd || 5} max={overview?.payment_max_usd || 10000} step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></div><div><Label htmlFor="top-up-network">USDT network</Label><NativeSelect id="top-up-network" value={network} onChange={(event) => setNetwork(event.target.value as 'TRC20' | 'BEP20')}><option value="TRC20">TRC20 · Tron</option><option value="BEP20">BEP20 · BNB Smart Chain</option></NativeSelect></div></div><div className="rounded-xl border border-amber-300/10 bg-amber-300/[0.025] p-3 text-[10px] leading-relaxed text-amber-100/70">Only send USDT on the selected network to the generated address. Wrong-network transfers may be unrecoverable. Provider confirmation is required before wallet credit.</div><Button type="submit" disabled={busy || loading || !overview?.payments_enabled} className="w-full">{busy ? 'Creating secure invoice…' : 'Generate deposit address'} <ArrowRight size={14} /></Button>{!overview?.payments_enabled && <p className="text-[10px] leading-relaxed text-slate-600">The operator must configure NOWPayments API/IPN credentials and a public HTTPS webhook before deposits are enabled.</p>}</form></CardContent></Card>
      </div>

      {activeDeposit && <Card className="mb-6 overflow-hidden border-cyan-300/15"><CardHeader className="pb-4"><div><CardTitle>USDT deposit instructions</CardTitle><CardDescription className="mt-1">Invoice status refreshes automatically while it is pending.</CardDescription></div><Badge tone={activeDeposit.status === 'FINISHED' ? 'green' : activeDeposit.status === 'FAILED' || activeDeposit.status === 'EXPIRED' ? 'red' : 'blue'}>{activeDeposit.status.replaceAll('_', ' ')}</Badge></CardHeader><CardContent className="grid gap-5 border-t border-white/[0.05] pt-5 lg:grid-cols-[190px_1fr]"><div className="flex items-center justify-center rounded-2xl bg-white p-4"><QRCodeSVG value={activeDeposit.pay_address || activeDeposit.order_id} size={158} level="M" includeMargin /></div><div className="min-w-0"><div className="grid gap-3 sm:grid-cols-3"><InfoCell label="Credit amount" value={formatCurrency(activeDeposit.amount_usd)} /><InfoCell label="Send exactly" value={activeDeposit.pay_amount ? `${activeDeposit.pay_amount} USDT` : 'Waiting for quote'} /><InfoCell label="Network" value={activeDeposit.network} /></div><div className="mt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">Deposit address</p><div className="flex flex-col gap-2 sm:flex-row"><code className="min-w-0 flex-1 break-all rounded-xl border border-white/[0.07] bg-[#070e17] p-3 font-mono text-[11px] leading-relaxed text-cyan-100">{activeDeposit.pay_address || 'Provider is preparing the payment address…'}</code><Button variant="outline" size="sm" onClick={() => activeDeposit.pay_address && void copyText(activeDeposit.pay_address, 'Address')} disabled={!activeDeposit.pay_address}><Copy size={13} /> Copy</Button></div></div><div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1.5"><Clock3 size={12} />{activeDeposit.expires_at ? `Expires ${formatDate(activeDeposit.expires_at)}` : 'Provider expiry applies'}</span>{activeDeposit.tx_hash && <span className="max-w-full break-all">Tx: {activeDeposit.tx_hash}</span>}<span>Invoice {activeDeposit.order_id.slice(0, 8)}…</span></div>{activeDeposit.status === 'FINISHED' ? <p className="mt-4 flex items-center gap-2 text-xs font-medium text-emerald-200"><Check size={14} /> Payment confirmed. The wallet has been credited.</p> : activeDeposit.status === 'FAILED' || activeDeposit.status === 'EXPIRED' ? <p className="mt-4 flex items-center gap-2 text-xs text-rose-200"><XCircle size={14} /> This invoice is no longer payable. Create a new deposit if needed.</p> : <p className="mt-4 text-[10px] leading-relaxed text-slate-500">Do not send a different token or network. Credit is applied only after the payment provider reports a fully settled payment.</p>}</div></CardContent></Card>}

      <div className="mb-7 grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <Card><CardHeader className="pb-3"><div><CardTitle>Telegram alerts</CardTitle><CardDescription className="mt-1">Securely link your private Telegram chat to Farhood.</CardDescription></div><Badge tone={overview?.telegram_linked ? 'green' : 'neutral'}>{overview?.telegram_linked ? 'Connected' : 'Not linked'}</Badge></CardHeader><CardContent className="pt-1"><p className="text-[10px] leading-relaxed text-slate-500">Receive trade fills, wallet credits, low-balance/risk events, panic activation, and subscription renewal alerts. Connect codes expire after 15 minutes and can be used once.</p>{connectCode ? <div className="mt-4 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.025] p-4"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-cyan-100/70">One-time connect command</p><div className="mt-2 flex flex-wrap items-center gap-2"><code className="flex-1 break-all rounded-lg bg-[#070e17] p-3 font-mono text-xs text-cyan-100">{connectCode.command}</code><Button size="sm" variant="outline" onClick={() => void copyText(connectCode.command, 'Connect command')}><Copy size={13} /> Copy</Button></div><div className="mt-3 flex flex-wrap items-center gap-3">{connectCode.deep_link && <a href={connectCode.deep_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-cyan-100 hover:text-white">Open Telegram <ExternalLink size={12} /></a>}<span className="text-[9px] text-slate-600">Expires {formatDate(connectCode.expires_at)}</span></div></div> : null}<div className="mt-4 flex flex-wrap gap-2">{overview?.telegram_linked ? <Button variant="outline" disabled={busy} onClick={() => void unlinkTelegram()}>Disconnect Telegram</Button> : <Button disabled={busy || !overview?.telegram_enabled} onClick={() => void createTelegramCode()}>{busy ? 'Creating…' : 'Generate connect code'} <ArrowRight size={13} /></Button>}{!overview?.telegram_enabled && <span className="self-center text-[10px] text-slate-600">Telegram bot credentials are not configured by the operator.</span>}</div></CardContent></Card>

        <Card className="border-amber-300/10 bg-amber-300/[0.02]"><CardHeader className="pb-3"><div><CardTitle className="flex items-center gap-2"><ShieldCheck size={15} className="text-amber-200" /> Payment safety</CardTitle><CardDescription className="mt-1">A crypto transfer cannot be reversed by Farhood.</CardDescription></div></CardHeader><CardContent className="space-y-2 pt-1 text-[10px] leading-relaxed text-slate-500"><p>Use a small test payment first. Check the network, token, address, and amount in your wallet before signing.</p><p>Wallet credit is applied once, after a signed provider webhook reports a settled payment. Never send seed phrases or private keys to support.</p><p>Subscription plan prices are server-configured; an upgrade debits one month immediately and renews automatically while funds are sufficient.</p></CardContent></Card>
      </div>

      <section className="mb-7"><div className="mb-4 flex items-end justify-between gap-3"><div><p className="eyebrow mb-1">Wallet-funded access</p><h2 className="text-lg font-semibold text-white">Monthly subscriptions</h2></div><span className="text-[10px] text-slate-600">Plan prices configured by the operator</span></div><div className="grid gap-3 md:grid-cols-3">{loading ? [1, 2, 3].map((item) => <Skeleton key={item} className="h-48" />) : (overview?.plans || []).map((plan) => {const current = activeSubscription && overview?.subscription?.tier === plan.tier; return <Card key={plan.tier} className={current ? 'border-emerald-300/20' : ''}><CardContent className="flex h-full flex-col p-5"><div className="flex items-center justify-between"><Badge tone={plan.tier === 'PRO' ? 'violet' : plan.tier === 'PLUS' ? 'blue' : 'neutral'}>{plan.tier}</Badge>{current && <Badge tone="green"><BadgeCheck size={11} /> Active</Badge>}</div><p className="mt-4 text-2xl font-semibold text-white">{formatCurrency(plan.monthly_price_usd)}<span className="text-[10px] font-normal text-slate-500"> / month</span></p><p className="mt-2 min-h-9 text-[10px] leading-relaxed text-slate-500">{current ? `Renews ${overview?.subscription?.ends_at ? formatDate(overview.subscription.ends_at) : 'monthly'}.` : 'Charged immediately from your USD wallet balance.'}</p><Button className="mt-auto" variant={current ? 'secondary' : 'outline'} disabled={busy || !!submittingTier || current || !overview} onClick={() => void subscribe(plan.tier)}>{submittingTier === plan.tier ? 'Processing…' : current ? 'Current plan' : activeSubscription ? `Switch to ${plan.tier}` : overview?.subscription?.status === 'PAST_DUE' ? 'Renew plan' : 'Subscribe'} <ArrowRight size={13} /></Button></CardContent></Card>;})}</div>{overview?.subscription?.status === 'PAST_DUE' && <div className="mt-3 rounded-xl border border-amber-300/10 bg-amber-300/[0.025] p-3 text-[10px] text-amber-100/70">Renewal could not be collected. Top up your wallet, then use Renew plan above; webhook trading is blocked while the plan is past due.</div>}</section>

      <Card className="mb-6 overflow-hidden"><CardHeader className="pb-4"><div><CardTitle>Wallet transaction history</CardTitle><CardDescription className="mt-1">Every top-up and wallet debit, including balance after each movement.</CardDescription></div><Badge>{overview?.wallet_transactions.length || 0} recent</Badge></CardHeader>{loading ? <div className="space-y-3 px-5 pb-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : overview?.wallet_transactions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead><tr className="border-y border-white/[0.055] text-[9px] uppercase tracking-[.14em] text-slate-600"><th className="px-5 py-3 font-semibold">Movement</th><th className="px-4 py-3 font-semibold">Reference</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-5 py-3 text-right font-semibold">Amount</th><th className="px-5 py-3 text-right font-semibold">Balance</th></tr></thead><tbody>{overview.wallet_transactions.map((transaction) => <tr key={transaction.id} className="border-b border-white/[0.04] last:border-0"><td className="px-5 py-3.5"><p className="font-semibold text-slate-200">{transaction.description}</p><p className="mt-1 text-[9px] uppercase tracking-wide text-slate-600">{transaction.transaction_type.replaceAll('_', ' ')}</p></td><td className="px-4 py-3.5 font-mono text-[10px] text-slate-500">{transaction.reference_type}</td><td className="px-4 py-3.5 text-[10px] text-slate-500">{formatDate(transaction.created_at)}</td><td className={`px-5 py-3.5 text-right font-mono font-semibold ${transaction.amount_usd >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{transaction.amount_usd >= 0 ? '+' : '−'}{formatCurrency(Math.abs(transaction.amount_usd))}</td><td className="px-5 py-3.5 text-right font-mono text-slate-300">{formatCurrency(transaction.balance_after)}</td></tr>)}</tbody></table></div> : <div className="px-5 pb-6 text-xs text-slate-500">No wallet movements yet. Confirmed top-ups, performance fees, and subscription charges will appear here.</div>}</Card>

      <Card><CardHeader className="pb-4"><div><CardTitle>Crypto deposit history</CardTitle><CardDescription className="mt-1">Payment state updates from the signed provider webhook.</CardDescription></div><Badge>{overview?.deposits.length || 0} recent</Badge></CardHeader>{loading ? <div className="space-y-3 px-5 pb-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : overview?.deposits.length ? <div className="divide-y divide-white/[0.04]">{overview.deposits.map((deposit) => <button key={deposit.id} type="button" onClick={() => setActiveDeposit(deposit)} className="flex w-full flex-col gap-2 px-5 py-4 text-left transition hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between"><span><span className="block text-xs font-semibold text-slate-200">{formatCurrency(deposit.amount_usd)} · USDT {deposit.network}</span><span className="mt-1 block font-mono text-[9px] text-slate-600">{deposit.order_id}</span></span><span className="flex items-center gap-3"><span className="text-[10px] text-slate-500">{formatDate(deposit.created_at)}</span><Badge tone={deposit.status === 'FINISHED' ? 'green' : deposit.status === 'FAILED' || deposit.status === 'EXPIRED' ? 'red' : 'blue'}>{deposit.status.replaceAll('_', ' ')}</Badge></span></button>)}</div> : <div className="px-5 pb-6 text-xs text-slate-500">No crypto invoices created yet.</div>}</Card>

      <div className="mt-6 flex flex-wrap gap-3"><ButtonLink href="/dashboard/subscription" variant="outline">Subscription details <ArrowRight size={13} /></ButtonLink><Link href="/docs#verify" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-slate-500 hover:text-white">Read the demo-first verification guide <ExternalLink size={13} /></Link></div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[0.055] bg-white/[0.02] p-3"><p className="text-[9px] uppercase tracking-[.12em] text-slate-600">{label}</p><p className="mt-1.5 break-all font-mono text-xs font-semibold text-slate-200">{value}</p></div>;
}
