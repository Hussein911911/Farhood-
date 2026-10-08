'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, BadgeCheck, CreditCard, ExternalLink, ReceiptText, Wallet } from 'lucide-react';
import { apiFetch, explainError } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import type { DashboardOverview, Subscription } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeading } from '@/components/ui/page-heading';
import { Skeleton } from '@/components/ui/skeleton';

const plans = [
  { name: 'BASIC', caption: 'Getting started', color: 'neutral' as const, included: ['1 MT5 account', 'Core webhook bridge', 'Essential risk limits'] },
  { name: 'PLUS', caption: 'Active traders', color: 'blue' as const, included: ['Multi-strategy workspace', 'Priority monitoring', 'Expanded analytics'] },
  { name: 'PRO', caption: 'Advanced execution', color: 'violet' as const, included: ['Full strategy catalog', 'Advanced operations tools', 'Professional support'] },
];

export function SubscriptionPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    Promise.all([
      apiFetch<DashboardOverview>('dashboard/overview'),
      apiFetch<{ subscriptions: Subscription[] }>('subscriptions'),
    ]).then(([dashboard, history]) => {
      if (mounted) { setOverview(dashboard); setSubscriptions(history.subscriptions); }
    }).catch((loadError) => {
      if (mounted) setError(explainError(loadError));
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  return (
    <div className="animate-rise">
      <PageHeading eyebrow="Billing & access" title="Plan & wallet" description="View your current plan and wallet credit. Plan changes and deposits must come from a trusted billing integration—not a client-side toggle." />
      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] p-3 text-xs text-rose-100">{error}</div>}
      <div className="mb-6 grid gap-4 md:grid-cols-[1.1fr_.9fr]">
        <Card className="overflow-hidden"><CardContent className="relative flex min-h-[170px] flex-col justify-between gap-6 p-6"><div className="absolute -right-8 -top-14 size-52 rounded-full bg-emerald-300/[0.05] blur-[48px]" /><div className="relative flex items-start justify-between"><div><p className="eyebrow mb-2">Available wallet credit</p>{loading ? <Skeleton className="h-9 w-36" /> : <h2 className="text-3xl font-semibold tracking-[-.05em] text-white">{formatCurrency(overview?.user.wallet_balance || 0)}</h2>}<p className="mt-2 text-xs text-slate-500">USD · fees are applied only to eligible profitable close fills</p></div><span className="flex size-11 items-center justify-center rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.055] text-emerald-200"><Wallet size={19} /></span></div><div className="relative flex items-center justify-between border-t border-white/[0.05] pt-4"><span className="text-[10px] text-slate-600">Wallet funds cannot be added from this browser.</span><Badge tone="amber">Billing setup required</Badge></div></CardContent></Card>
        <Card><CardHeader className="pb-4"><div><CardTitle>Current access</CardTitle><CardDescription className="mt-1">Subscription state evaluated by the webhook</CardDescription></div><CreditCard size={17} className="text-slate-500" /></CardHeader><CardContent className="pt-1">{loading ? <Skeleton className="h-20" /> : <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4"><div className="flex items-center justify-between"><span className="text-lg font-semibold text-white">{overview?.subscription?.tier || overview?.user.subscription_tier || 'BASIC'}</span><Badge tone={overview?.subscription ? 'green' : 'amber'}>{overview?.subscription?.status || 'NO ACTIVE SUBSCRIPTION'}</Badge></div><p className="mt-2 text-xs leading-relaxed text-slate-500">{overview?.subscription ? `Started ${formatDate(overview.subscription.starts_at)}${overview.subscription.ends_at ? ` · ends ${formatDate(overview.subscription.ends_at)}` : ''}` : 'Your account is not currently entitled to send execution webhooks.'}</p></div>}<p className="mt-3 text-[10px] leading-relaxed text-slate-600">A user cannot self-activate a paid tier. Connect your verified billing provider or use the local demo-provision script for development only.</p></CardContent></Card>
      </div>

      <div className="mb-7 flex items-start gap-3 rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.025] p-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cyan-300/[0.08] text-cyan-200"><ReceiptText size={15} /></span><div><p className="text-xs font-semibold text-slate-200">Checkout is not connected in Marketplace V1</p><p className="mt-1 text-[10px] leading-relaxed text-slate-500">Catalog prices are preview values. Attaching a strategy creates a bot configuration but does not subscribe you to paid service or charge your card. Add signed billing webhooks before launch.</p></div></div>

      <div className="mb-5 flex items-end justify-between gap-3"><div><p className="eyebrow mb-2">Membership tiers</p><h2 className="text-lg font-semibold text-white">Platform access</h2></div><span className="text-[10px] text-slate-600">Displayed plans · no checkout configured</span></div>
      <div className="mb-8 grid gap-3 md:grid-cols-3">{plans.map((plan) => <Card key={plan.name} className={`${overview?.user.subscription_tier === plan.name ? 'border-emerald-300/20' : ''}`}><CardContent className="p-5"><div className="flex items-center justify-between"><Badge tone={plan.color}>{plan.name}</Badge>{overview?.user.subscription_tier === plan.name && <Badge tone="green"><BadgeCheck size={11} /> Current</Badge>}</div><h3 className="mt-4 text-sm font-semibold text-slate-100">{plan.caption}</h3><ul className="mt-4 space-y-2">{plan.included.map((item) => <li key={item} className="flex items-center gap-2 text-[10px] text-slate-500"><span className="size-1 rounded-full bg-emerald-300/60" />{item}</li>)}</ul></CardContent></Card>)}</div>

      <Card className="overflow-hidden"><CardHeader className="pb-4"><div><CardTitle>Subscription history</CardTitle><CardDescription className="mt-1">Provisioned by a trusted operator or billing provider</CardDescription></div><Badge>{subscriptions.length} records</Badge></CardHeader>{loading ? <div className="space-y-3 px-5 pb-5"><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : subscriptions.length ? <div className="divide-y divide-white/[0.04]">{subscriptions.map((subscription) => <div key={subscription.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-200">{subscription.tier}</span><Badge tone={subscription.status === 'ACTIVE' || subscription.status === 'TRIAL' ? 'green' : 'neutral'}>{subscription.status}</Badge></div><p className="mt-1 text-[10px] text-slate-600">Started {formatDate(subscription.starts_at)}{subscription.ends_at ? ` · ends ${formatDate(subscription.ends_at)}` : ''}</p></div><span className="text-[10px] text-slate-500">{subscription.provider || 'Operator-provisioned'}</span></div>)}</div> : <div className="px-5 pb-5 pt-2 text-xs text-slate-500">No subscription records are attached to this user yet.</div>}</Card>
      <div className="mt-6"><ButtonLink href="/docs#setup" variant="outline">Read account setup guide <ArrowRight size={14} /></ButtonLink></div>
    </div>
  );
}
