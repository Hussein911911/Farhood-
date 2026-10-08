'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowRight, Copy, ExternalLink, KeyRound, LockKeyhole, Plus, ShieldCheck, Trash2, Webhook, X } from 'lucide-react';
import { apiFetch, explainError, jsonBody } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { ApiKey, Bot } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/input';
import { PageHeading } from '@/components/ui/page-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

type NewKey = ApiKey & { secret_key: string; warning?: string };

export function SecurityPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('TradingView alerts');
  const [botId, setBotId] = useState('');
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState<NewKey | null>(null);
  const [error, setError] = useState('');
  const { toast } = useToast();

  async function refresh() {
    try {
      const [keyData, botData] = await Promise.all([
        apiFetch<{ api_keys: ApiKey[] }>('api-keys'),
        apiFetch<{ bots: Bot[] }>('bots'),
      ]);
      setKeys(keyData.api_keys); setBots(botData.bots); setError('');
    } catch (loadError) { setError(explainError(loadError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreating(true); setError('');
    try {
      const result = await apiFetch<NewKey>('api-keys', { method: 'POST', body: jsonBody({ label, bot_id: botId || null }) });
      setNewKey(result); setCreateOpen(false); setLabel('TradingView alerts'); setBotId('');
      await refresh();
      toast({ kind: 'success', title: 'API key created', description: 'Save the secret before you close this dialog.' });
    } catch (createError) { setError(explainError(createError)); }
    finally { setCreating(false); }
  }

  async function revoke(key: ApiKey) {
    if (!window.confirm(`Revoke “${key.label}”? Webhooks using this secret will be rejected immediately.`)) return;
    setRevoking(key.id);
    try {
      await apiFetch<void>(`api-keys/${key.id}`, { method: 'DELETE' });
      await refresh();
      toast({ kind: 'success', title: 'API key revoked', description: 'The secret is no longer valid.' });
    } catch (revokeError) { toast({ kind: 'error', title: 'Could not revoke key', description: explainError(revokeError) }); }
    finally { setRevoking(null); }
  }

  return (
    <div className="animate-rise">
      <PageHeading eyebrow="Security & integrations" title="API keys & webhook security" description="Create a one-time TradingView secret, scope it to a bot, and revoke access instantly when a key is exposed." action={<Button onClick={() => setCreateOpen(true)}><Plus size={15} /> New API key</Button>} />
      <div className="mb-6 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <Card><CardHeader className="pb-3"><div><CardTitle>Credential hygiene</CardTitle><CardDescription className="mt-1">Secrets are never shown again after generation.</CardDescription></div><div className="flex size-9 items-center justify-center rounded-xl bg-emerald-300/[0.07] text-emerald-200"><ShieldCheck size={17} /></div></CardHeader><CardContent className="grid gap-3 pt-2 sm:grid-cols-3">{[['01', 'Scope', 'Limit each key to one bot where possible.'], ['02', 'Store', 'Put the secret in a private TradingView input.'], ['03', 'Rotate', 'Revoke immediately if it appears in a log or screenshot.']].map(([num, title, description]) => <div key={num} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><span className="font-mono text-[9px] text-emerald-200/65">{num}</span><p className="mt-2 text-xs font-semibold text-slate-200">{title}</p><p className="mt-1 text-[10px] leading-relaxed text-slate-600">{description}</p></div>)}</CardContent></Card>
        <Card className="border-amber-300/10 bg-amber-300/[0.02]"><CardHeader className="pb-3"><div><CardTitle className="flex items-center gap-2"><LockKeyhole size={15} className="text-amber-200" /> Session handling</CardTitle><CardDescription className="mt-1">Browser sessions are protected at the app boundary.</CardDescription></div></CardHeader><CardContent className="pt-2"><ul className="space-y-2 text-[10px] leading-relaxed text-slate-500"><li className="flex gap-2"><span className="text-emerald-300">✓</span> Opaque session bearer stored in an HttpOnly cookie.</li><li className="flex gap-2"><span className="text-emerald-300">✓</span> SameSite=Lax; Secure in production; mutation origin checks.</li><li className="flex gap-2"><span className="text-emerald-300">✓</span> Server-side proxy forwards the token; client code never reads it.</li></ul></CardContent></Card>
      </div>

      {error && <div role="alert" className="mb-5 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] p-3 text-xs text-rose-100">{error}</div>}
      <Card className="overflow-hidden">
        <CardHeader className="pb-5"><div><CardTitle>TradingView API keys</CardTitle><CardDescription className="mt-1">{keys.filter((key) => key.is_active).length} active · hashed at rest with a server-side pepper</CardDescription></div><Badge tone="blue"><KeyRound size={11} /> {keys.length} total</Badge></CardHeader>
        {loading ? <div className="space-y-3 px-5 pb-5"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : keys.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr className="border-y border-white/[0.055] text-[9px] uppercase tracking-[.14em] text-slate-600"><th className="px-6 py-3 font-semibold">Key</th><th className="px-4 py-3 font-semibold">Bot scope</th><th className="px-4 py-3 font-semibold">Created</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-6 py-3 text-right font-semibold">Action</th></tr></thead><tbody>{keys.map((key) => <tr key={key.id} className="border-b border-white/[0.04] last:border-0"><td className="px-6 py-4"><p className="font-semibold text-slate-200">{key.label}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{key.key_prefix}••••••••</p></td><td className="px-4 py-4 text-slate-400">{key.bot_id ? bots.find((bot) => bot.id === key.bot_id)?.bot_name || 'Scoped bot' : 'Any owned bot'}</td><td className="px-4 py-4 text-slate-500">{formatDate(key.created_at)}</td><td className="px-4 py-4"><Badge tone={key.is_active ? 'green' : 'neutral'}>{key.is_active ? 'Active' : 'Revoked'}</Badge></td><td className="px-6 py-4 text-right">{key.is_active && <Button size="sm" variant="ghost" disabled={revoking === key.id} onClick={() => void revoke(key)} className="text-rose-200 hover:bg-rose-300/[0.07]"><Trash2 size={13} /> {revoking === key.id ? 'Revoking…' : 'Revoke'}</Button>}</td></tr>)}</tbody></table></div> : <div className="flex flex-col items-center border-t border-white/[0.05] px-6 py-14 text-center"><div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-slate-500"><Webhook size={18} /></div><p className="text-sm font-semibold text-slate-200">No webhook keys yet</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">Create a key for your TradingView alert. We show its secret once, then store only a hash.</p><Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}><Plus size={13} /> Generate first key</Button></div>}
      </Card>

      <Card className="mt-5"><CardHeader className="pb-3"><div><CardTitle>Webhook payload preview</CardTitle><CardDescription className="mt-1">Use the secret in a private input, not in a public Pine source or screenshot.</CardDescription></div><Link href="/docs#tradingview" className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-200 hover:text-white">Full setup <ExternalLink size={12} /></Link></CardHeader><CardContent className="pt-2"><div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#070e17] p-4"><pre className="min-w-[430px] font-mono text-[10px] leading-6 text-cyan-100/75">{`{
  "secret_key": "<store-as-private-alert-input>",
  "signal_id": "eurusd-15m-001",
  "action": "BUY",
  "symbol": "EURUSD",
  "lot": 0.05,
  "stop_loss": 25,
  "take_profit": 50,
  "stop_loss_type": "pips",
  "take_profit_type": "pips"
}`}</pre></div></CardContent></Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>Create TradingView API key</DialogTitle><DialogDescription>Store this secret in TradingView's private alert message/input. It will not be recoverable after creation.</DialogDescription></DialogHeader><form onSubmit={create} className="space-y-4"><div><Label htmlFor="key-label">Label</Label><Input id="key-label" required maxLength={64} value={label} onChange={(event) => setLabel(event.target.value)} /></div><div><Label htmlFor="key-bot">Bot scope <span className="font-normal text-slate-600">· recommended</span></Label><NativeSelect id="key-bot" value={botId} onChange={(event) => setBotId(event.target.value)}><option value="">All of my active bots</option>{bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.bot_name}</option>)}</NativeSelect><p className="mt-1.5 text-[10px] text-slate-600">A scoped key can only place signals for that bot.</p></div><div className="rounded-xl border border-amber-300/10 bg-amber-300/[0.035] p-3 text-[10px] leading-relaxed text-amber-100/70"><AlertTriangle size={13} className="mr-1.5 inline" />Anyone with this key can submit webhook signals for its scope. Keep it private and test with an MT5 demo account.</div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" disabled={creating}>{creating ? 'Generating…' : 'Generate key'} <ArrowRight size={14} /></Button></div></form></DialogContent></Dialog>

      <Dialog open={!!newKey} onOpenChange={(open) => { if (!open) setNewKey(null); }}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Copy your new API key</DialogTitle><DialogDescription>This value is shown once. Paste it directly into a private TradingView alert input, never into source code.</DialogDescription></DialogHeader>{newKey && <NewKeyCard apiKey={newKey} onClose={() => setNewKey(null)} />}</DialogContent></Dialog>
    </div>
  );
}

function NewKeyCard({ apiKey, onClose }: { apiKey: NewKey; onClose: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(apiKey.secret_key); setCopied(true); toast({ kind: 'success', title: 'API key copied' }); }
    catch { toast({ kind: 'error', title: 'Clipboard unavailable', description: 'Select the key and copy it manually.' }); }
  }
  return <div className="space-y-4"><div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3 text-xs leading-relaxed text-amber-100"><AlertTriangle size={14} className="mr-2 inline" />{apiKey.warning || 'This key cannot be shown again. If lost, revoke it and generate another.'}</div><div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-500">{apiKey.label}</p><div className="break-all rounded-xl border border-white/[0.07] bg-[#070e17] p-4 font-mono text-xs text-emerald-100">{apiKey.secret_key}</div></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Close and clear</Button><Button onClick={copy}><Copy size={14} />{copied ? 'Copied' : 'Copy secret'}</Button></div></div>;
}
