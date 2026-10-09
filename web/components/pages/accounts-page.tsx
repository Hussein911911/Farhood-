'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowRight, Cable, Check, Copy, KeyRound, Plus, RefreshCw, Server, ShieldCheck, Trash2, WalletCards } from 'lucide-react';
import { apiFetch, explainError, jsonBody } from '@/lib/api';
import { formatDate, isBridgeOnline, relativeTime } from '@/lib/format';
import type { Mt5Account } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeading } from '@/components/ui/page-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

 type AccountCredential = Mt5Account & { bridge_key: string; warning?: string };

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Mt5Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [credential, setCredential] = useState<AccountCredential | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [brokerServer, setBrokerServer] = useState('');
  const [investorPassword, setInvestorPassword] = useState('');
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ mt5_accounts: Mt5Account[] }>('mt5-accounts');
      setAccounts(data.mt5_accounts);
      setError('');
    } catch (loadError) {
      setError(explainError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await apiFetch<{ mt5_accounts: Mt5Account[] }>('mt5-accounts');
        if (mounted) { setAccounts(data.mt5_accounts); setError(''); }
      } catch (loadError) {
        if (mounted) setError(explainError(loadError));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await apiFetch<AccountCredential>('mt5-accounts', {
        method: 'POST',
        body: jsonBody({ account_number: accountNumber, broker_server: brokerServer, investor_password: investorPassword || undefined }),
      });
      setAccounts((current) => [result, ...current]);
      setFormOpen(false);
      setCredential(result);
      setAccountNumber(''); setBrokerServer(''); setInvestorPassword('');
      toast({ kind: 'success', title: 'MT5 account registered', description: 'Copy the bridge key now; it is shown only once.' });
    } catch (submitError) {
      setError(explainError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function rotate(account: Mt5Account) {
    setBusyId(account.id);
    try {
      const result = await apiFetch<AccountCredential>(`mt5-accounts/${account.id}/rotate-bridge-key`, { method: 'POST', body: jsonBody({}) });
      setCredential(result);
      await refresh();
      toast({ kind: 'success', title: 'Bridge credentials rotated', description: 'The previous bridge key is now invalid.' });
    } catch (actionError) {
      toast({ kind: 'error', title: 'Could not rotate key', description: explainError(actionError) });
    } finally {
      setBusyId(null);
    }
  }

  async function deactivate(account: Mt5Account) {
    if (!window.confirm(`Deactivate ${account.broker_server} · login ${account.account_number}? Pending commands will fail.`)) return;
    setBusyId(account.id);
    try {
      await apiFetch<void>(`mt5-accounts/${account.id}`, { method: 'DELETE' });
      await refresh();
      toast({ kind: 'success', title: 'MT5 account deactivated', description: 'Queued commands were cancelled.' });
    } catch (actionError) {
      toast({ kind: 'error', title: 'Could not deactivate account', description: explainError(actionError) });
    } finally {
      setBusyId(null);
    }
  }

  async function reactivate(account: Mt5Account) {
    setBusyId(account.id);
    try {
      const result = await apiFetch<AccountCredential>(`mt5-accounts/${account.id}/activate`, { method: 'POST', body: jsonBody({}) });
      setCredential(result);
      await refresh();
      toast({ kind: 'success', title: 'Account reactivated', description: 'Use the new bridge credentials in the EA.' });
    } catch (actionError) {
      toast({ kind: 'error', title: 'Could not reactivate account', description: explainError(actionError) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="animate-rise">
      <PageHeading eyebrow="Connectivity" title="MT5 accounts" description="Register the demo login that your bridge EA is allowed to control. Account passwords are encrypted at rest and never returned by list endpoints." action={<Button onClick={() => setFormOpen(true)}><Plus size={15} /> Add account</Button>} />
      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <InfoTile icon={Cable} title="Account-scoped bridge" description="Each account has an independent bridge ID and one-time key." />
        <InfoTile icon={ShieldCheck} title="Demo-first guard" description="Trial entries require a fresh EA-reported DEMO mode; this is not independent broker verification." />
        <InfoTile icon={WalletCards} title="Secrets stay private" description="Investor credentials are encrypted and hidden after save." />
      </div>

      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] p-3 text-xs text-rose-100">{error}</div>}
      <div className="space-y-4">
        {loading && !accounts.length ? <><Skeleton className="h-44" /><Skeleton className="h-44" /></> : accounts.length ? accounts.map((account) => {
          const online = account.is_active && isBridgeOnline(account.last_seen_at, account.connection_status);
          const busy = busyId === account.id;
          return (
            <Card key={account.id} className="overflow-hidden">
              <CardHeader className="pb-5">
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl border ${online ? 'border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-200' : 'border-white/[0.07] bg-white/[0.03] text-slate-400'}`}><Server size={19} /></div>
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">{account.broker_server}</CardTitle><Badge tone={online ? 'green' : account.is_active ? 'amber' : 'neutral'}><span className={`size-1.5 rounded-full ${online ? 'bg-emerald-300' : 'bg-current opacity-60'}`} />{online ? 'Online' : account.is_active ? 'Offline' : 'Paused'}</Badge>{account.reported_trade_mode !== 'UNKNOWN' && <Badge tone={account.reported_trade_mode === 'DEMO' ? 'green' : 'amber'}>Last EA mode: {account.reported_trade_mode}</Badge>}</div><p className="mt-1.5 text-xs text-slate-500">Login <span className="font-mono text-slate-300">{account.account_number}</span> · last heartbeat {relativeTime(account.last_seen_at)}</p></div>
                </div>
                <span className="hidden text-right text-[10px] text-slate-600 sm:block">Added {formatDate(account.created_at)}</span>
              </CardHeader>
              <CardContent className="grid gap-4 border-t border-white/[0.05] bg-white/[0.012] pt-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-slate-600">Bridge ID</p><p className="mt-1 truncate font-mono text-xs text-slate-400">{account.bridge_id}</p><p className="mt-2 text-[10px] leading-relaxed text-slate-600">Bridge key is stored as a hash; it cannot be retrieved. Rotate it only when the EA is ready for new credentials.</p></div>
                <div className="flex flex-wrap gap-2">
                  {account.is_active ? <>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void rotate(account)}><KeyRound size={13} /> {busy ? 'Working…' : 'Rotate bridge key'}</Button>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => void deactivate(account)}><Trash2 size={13} /> Deactivate</Button>
                  </> : <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reactivate(account)}><RefreshCw size={13} /> {busy ? 'Working…' : 'Reactivate'}</Button>}
                </div>
              </CardContent>
            </Card>
          );
        }) : !loading ? <Card><CardContent className="flex flex-col items-center py-16 text-center"><div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] text-slate-400"><Cable size={21} /></div><h2 className="text-sm font-semibold text-white">Connect your first MT5 account</h2><p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500">Start with a demo terminal. Register the account login and exact broker server, then add the generated bridge credentials to the EA.</p><Button className="mt-5" onClick={() => setFormOpen(true)}><Plus size={14} /> Add demo account</Button></CardContent></Card> : null}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Register an MT5 account</DialogTitle><DialogDescription>Use a demo account first. The EA checks these values against the terminal at startup.</DialogDescription></DialogHeader>
          <form onSubmit={createAccount} className="space-y-4">
            <div><Label htmlFor="account-number">MT5 account number</Label><Input id="account-number" inputMode="numeric" pattern="[0-9]{1,32}" autoComplete="off" required value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} placeholder="e.g. 12345678" /></div>
            <div><Label htmlFor="broker-server">Broker server</Label><Input id="broker-server" required maxLength={128} value={brokerServer} onChange={(event) => setBrokerServer(event.target.value)} placeholder="Exact server name shown in MT5" /></div>
            <div><Label htmlFor="investor-password">Investor password <span className="font-normal text-slate-600">· optional</span></Label><Input id="investor-password" type="password" autoComplete="new-password" maxLength={512} value={investorPassword} onChange={(event) => setInvestorPassword(event.target.value)} placeholder="Optional read-only credential" /><p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">The EA does not use this password; leave blank if you do not need it stored.</p></div>
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/10 bg-amber-300/[0.04] p-3 text-[10px] leading-relaxed text-amber-100/75"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-200" />Use a demo terminal while validating symbols, volume steps, stops, and execution results.</div>
            <div className="flex justify-end gap-2 pt-1"><Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Create account'} <ArrowRight size={14} /></Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!credential} onOpenChange={(open) => { if (!open) setCredential(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Save your bridge credentials</DialogTitle><DialogDescription>These are shown once. Copy them to a secure password manager, then enter them in the MT5 EA inputs.</DialogDescription></DialogHeader>
          {credential && <CredentialCard account={credential} onClose={() => setCredential(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoTile({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return <Card><CardContent className="flex gap-3 p-4"><span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-300/[0.06] text-emerald-200"><Icon size={15} /></span><div><p className="text-xs font-semibold text-slate-200">{title}</p><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{description}</p></div></CardContent></Card>;
}

function CredentialCard({ account, onClose }: { account: AccountCredential; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const values = `InpBaseUrl=<your API base URL>\nInpExpectedAccountNumber=${account.account_number}\nInpExpectedBrokerServer=${account.broker_server}\nInpBridgeId=${account.bridge_id}\nInpBridgeKey=${account.bridge_key}`;
  async function copy() {
    try { await navigator.clipboard.writeText(values); setCopied(true); toast({ kind: 'success', title: 'Bridge credentials copied' }); }
    catch { toast({ kind: 'error', title: 'Clipboard unavailable', description: 'Copy each field manually.' }); }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.045] p-3.5 text-xs leading-relaxed text-emerald-100"><Check size={14} className="mr-2 inline" />{account.warning || 'The bridge key will not be retrievable after you close this dialog.'}</div>
      <CredentialField label="Expected MT5 login" value={account.account_number} />
      <CredentialField label="Expected broker server" value={account.broker_server} />
      <CredentialField label="Bridge ID" value={account.bridge_id} />
      <CredentialField label="Bridge key · one time" value={account.bridge_key} secret />
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end"><Button variant="outline" onClick={onClose}>Close and clear</Button><Button onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied setup values' : 'Copy EA setup values'}</Button></div>
      <p className="text-center text-[10px] text-slate-600">Closing clears the secret from this page state. Never paste it into TradingView.</p>
    </div>
  );
}

function CredentialField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  return <div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-600">{label}</p><div className="rounded-lg border border-white/[0.07] bg-[#08111c] p-3 font-mono text-xs break-all text-slate-200">{value}{secret && <Badge className="ml-2 align-middle" tone="amber">shown once</Badge>}</div></div>;
}
