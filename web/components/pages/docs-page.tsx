'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Check, Gauge, Monitor, Plus, Radio, ShieldCheck, Smartphone, Terminal, Video } from 'lucide-react';
import { CopyButton } from '@/components/ui/copy-button';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const pineExample = `//@version=5
indicator("Farhood signal example", overlay=true)

fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
plot(fast, "Fast EMA", color=color.teal)
plot(slow, "Slow EMA", color=color.orange)

longSignal = ta.crossover(fast, slow)
shortSignal = ta.crossunder(fast, slow)

// Create the TradingView alert in the UI. Use a private alert message
// containing the JSON template below. Do not put API keys in public scripts.
alertcondition(longSignal, "BUY", "BUY")
alertcondition(shortSignal, "SELL", "SELL")`;

const jsonExample = `{
  "secret_key": "<your-one-time-user-api-key>",
  "signal_id": "eurusd-15m-001",
  "action": "BUY",
  "symbol": "EURUSD",
  "lot": 0.05,
  "stop_loss": 25,
  "take_profit": 50,
  "stop_loss_type": "pips",
  "take_profit_type": "pips"
}`;

const curlExample = `curl -i -X POST https://YOUR_PUBLIC_HOST/api/v1/webhook \\
  -H 'Content-Type: application/json' \\
  -d '${jsonExample.replaceAll("'", "'\\''")}'`;

const setupSteps = [
  { title: 'Create a workspace', description: 'Register and sign in; subscriptions and wallet credit are provisioned separately.', href: '/register', label: 'Create account' },
  { title: 'Connect MT5 demo', description: 'Register exact account/server values, then copy the one-time bridge credentials into the EA.', href: '/dashboard/accounts', label: 'Add account' },
  { title: 'Create a bot profile', description: 'Attach it to an MT5 account and set the absolute daily USD loss cap and max lot.', href: '/dashboard/bots', label: 'Configure risk' },
  { title: 'Issue a webhook key', description: 'Scope one API key to the bot. Store the returned secret privately in the TradingView alert.', href: '/dashboard/security', label: 'Generate API key' },
  { title: 'Install EA and alert', description: 'Compile the Expert Advisor, allow WebRequest, then use the same HTTPS webhook URL in TradingView.', href: '#mt5', label: 'Follow install steps' },
  { title: 'Verify one demo signal', description: 'Check the webhook response, MT5 Experts tab, broker retcode, and trade log before scaling.', href: '#verify', label: 'Run checklist' },
];

const mt5Steps = [
  ['Open data folder', 'In MT5 choose File → Open Data Folder, then open MQL5/Experts.'],
  ['Copy and compile', 'Copy TradingViewBridgeEA.mq5 from the repository into Experts. Open MetaEditor and press F7; fix any compiler errors before continuing.'],
  ['Allow the API URL', 'In Tools → Options → Expert Advisors, enable Allow WebRequest for listed URL and add the exact API base URL.'],
  ['Attach to a demo chart', 'Open a chart on the registered demo account, attach TradingViewBridgeEA, and enter the expected login, exact broker server, bridge ID, bridge key, and magic number.'],
  ['Enable safe permissions', 'Turn on Algo Trading and allow automated trading for the EA. Leave InpAllowLiveAccount=false during setup.'],
  ['Check the Experts tab', 'Wait for a successful position snapshot and command poll. The dashboard heartbeat should switch to Online within the stale timeout.'],
];

export function DocsPage() {
  const [checked, setChecked] = useState<string[]>([]);
  const completed = useMemo(() => setupSteps.filter((step) => checked.includes(step.title)).length, [checked]);
  function toggle(title: string) {
    setChecked((current) => current.includes(title) ? current.filter((item) => item !== title) : [...current, title]);
  }
  return (
    <main className="min-h-screen bg-[#07101b]">
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#07101b]/85 backdrop-blur-xl"><div className="mx-auto flex h-[66px] max-w-[1180px] items-center justify-between px-4 sm:px-6"><Link href="/dashboard" className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl border border-emerald-300/15 bg-emerald-300/[0.08] text-emerald-200"><Terminal size={16} /></span><span className="text-sm font-semibold tracking-tight text-white">farhood<span className="text-emerald-300">.</span><span className="ml-2 font-normal text-slate-600">docs</span></span></Link><div className="flex items-center gap-3"><Link href="/dashboard" className="hidden text-xs text-slate-500 hover:text-white sm:block">Back to workspace <ArrowRight size={12} className="ml-1 inline" /></Link><ButtonLink href="/login" size="sm">Sign in</ButtonLink></div></div></header>
      <div className="subtle-grid pointer-events-none absolute left-0 right-0 top-[66px] h-[400px] opacity-25" />
      <div className="relative mx-auto max-w-[1180px] px-4 pb-16 pt-9 sm:px-6 sm:pt-14">
        <section className="mb-12 grid gap-8 lg:grid-cols-[1fr_360px] lg:items-end"><div><p className="eyebrow mb-3">Setup guide · Phase 3</p><h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-[-.05em] text-white sm:text-5xl">From chart signal to<br className="hidden sm:block" /> <span className="text-emerald-300">demo execution.</span></h1><p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">A secure, step-by-step walkthrough for connecting TradingView alerts to the MT5 bridge. Start with a demo account and verify every broker response.</p><div className="mt-6 flex flex-wrap gap-2"><ButtonLink href="/dashboard/accounts"><Plus size={14} /> Connect an account</ButtonLink><ButtonLink href="#tradingview" variant="outline"><BookOpen size={14} /> View Pine example</ButtonLink></div></div><Card className="bg-[#0c1825]/85"><CardContent className="p-5"><div className="mb-4 flex items-center justify-between"><span className="text-xs font-semibold text-slate-200">Setup progress</span><BadgeCount completed={completed} total={setupSteps.length} /></div><div className="h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-emerald-300 transition-all duration-300" style={{ width: `${(completed / setupSteps.length) * 100}%` }} /></div><p className="mt-3 text-[10px] leading-relaxed text-slate-500">Your checklist is stored only in this tab and resets when you refresh.</p></CardContent></Card></section>

        <section className="mb-14 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{setupSteps.map((step, index) => {
          const done = checked.includes(step.title);
          return <Card key={step.title} className={done ? 'border-emerald-300/15' : ''}><CardContent className="flex h-full flex-col p-5"><button onClick={() => toggle(step.title)} className="mb-4 flex w-fit items-center gap-2 text-left"><span className={`flex size-7 items-center justify-center rounded-lg border font-mono text-[10px] ${done ? 'border-emerald-300/20 bg-emerald-300/[0.09] text-emerald-200' : 'border-white/[0.08] bg-white/[0.025] text-slate-500'}`}>{done ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span><span className="text-xs font-semibold text-slate-200">{step.title}</span></button><p className="min-h-10 flex-1 text-[10px] leading-relaxed text-slate-500">{step.description}</p><Link href={step.href} className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-200 hover:text-white">{step.label} <ArrowRight size={12} /></Link></CardContent></Card>;
        })}</section>

        <section id="tradingview" className="mb-14 scroll-mt-24"><SectionHeading number="01" label="TradingView" title="Build and test your alert" description="Add a Pine v5 script to a chart, then create an alert that posts a private JSON message to the webhook." /><div className="grid gap-4 lg:grid-cols-[1fr_.9fr]"><CodeCard title="Pine Script v5 · moving-average signal sample" language="pine" code={pineExample} /><div className="space-y-4"><Card><CardHeader><div><CardTitle className="flex items-center gap-2"><Radio size={15} className="text-emerald-200" /> Create an alert</CardTitle><p className="mt-1 text-[10px] text-slate-500">Use “Any alert() function call” or an alertcondition.</p></div></CardHeader><CardContent className="space-y-3 pt-2">{['Choose the chart symbol and timeframe.', 'Add your Pine script and confirm the expected alert condition.', 'Set the webhook URL to https://YOUR_PUBLIC_HOST/api/v1/webhook.', 'Paste the JSON payload into the alert message and use a private user API key.'].map((item, index) => <div key={item} className="flex gap-3"><span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-white/[0.07] font-mono text-[9px] text-slate-500">{index + 1}</span><p className="text-[10px] leading-relaxed text-slate-400">{item}</p></div>)}</CardContent></Card><Card><CardHeader><div><CardTitle>Copyable JSON payload</CardTitle><p className="mt-1 text-[10px] text-slate-500">Replace the placeholder with your scoped API key.</p></div><CopyButton value={jsonExample} label="Copy JSON" /></CardHeader><CardContent className="pt-3"><pre className="overflow-x-auto rounded-xl border border-white/[0.055] bg-[#070e17] p-4 font-mono text-[10px] leading-5 text-cyan-100/75">{jsonExample}</pre></CardContent></Card></div></div><div className="mt-4 rounded-xl border border-amber-300/10 bg-amber-300/[0.025] p-4 text-[10px] leading-relaxed text-amber-100/65"><ShieldCheck size={14} className="mr-2 inline text-amber-200" />Never publish an API key inside a public Pine source. The full webhook key is displayed once; store it in a private alert configuration and rotate it if exposed.</div></section>

        <section id="mt5" className="mb-14 scroll-mt-24"><SectionHeading number="02" label="MetaTrader 5" title="Install the bridge EA" description="The visual checklist below replaces a video walkthrough. The EA reports its managed open positions and receives account-scoped commands." /><div className="mb-5 grid gap-4 lg:grid-cols-[.85fr_1.15fr]"><Card className="overflow-hidden"><div className="subtle-grid flex h-[210px] items-center justify-center border-b border-white/[0.05] bg-gradient-to-br from-emerald-300/[0.055] to-transparent"><div className="relative flex items-center gap-4"><div className="rounded-2xl border border-white/[0.08] bg-[#101d2a] p-4 shadow-xl"><Monitor size={28} className="text-emerald-200" /></div><ArrowRight size={20} className="text-slate-600" /><div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.06] p-4 shadow-[0_0_35px_-15px_rgba(110,231,183,.4)]"><ActivityIcon /></div><ArrowRight size={20} className="text-slate-600" /><div className="rounded-2xl border border-white/[0.08] bg-[#101d2a] p-4 shadow-xl"><SignalIcon /></div></div></div><CardContent className="p-5"><p className="text-xs font-semibold text-slate-200">A simple connection path</p><p className="mt-2 text-[10px] leading-relaxed text-slate-500">TradingView signal → authenticated API queue → demo MT5 terminal. The API key and bridge key are separate secrets.</p></CardContent></Card><Card><CardHeader><div><CardTitle className="flex items-center gap-2"><Video size={15} className="text-cyan-200" /> Before attaching the EA</CardTitle><p className="mt-1 text-[10px] text-slate-500">Check these terminal settings in order.</p></div></CardHeader><CardContent className="space-y-3 pt-2">{mt5Steps.slice(0, 3).map(([title, description], index) => <VisualStep key={title} index={index + 1} title={title} description={description} />)}</CardContent></Card></div><Card><CardHeader><div><CardTitle>MT5 install checklist</CardTitle><p className="mt-1 text-[10px] text-slate-500">Complete each step in MetaTrader and MetaEditor.</p></div><BadgeCount completed={mt5Steps.filter(([title]) => checked.includes(title)).length} total={mt5Steps.length} /></CardHeader><CardContent className="grid gap-3 pt-2 sm:grid-cols-2">{mt5Steps.map(([title, description], index) => <button key={title} onClick={() => toggle(title)} className="flex gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3.5 text-left transition hover:border-white/[0.1]"><span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${checked.includes(title) ? 'border-emerald-300/25 bg-emerald-300/[0.09] text-emerald-200' : 'border-white/[0.10] text-slate-600'}`}>{checked.includes(title) ? <Check size={12} /> : <span className="text-[9px]">{index + 1}</span>}</span><span><span className="block text-[10px] font-semibold text-slate-200">{title}</span><span className="mt-1 block text-[9px] leading-relaxed text-slate-500">{description}</span></span></button>)}</CardContent></Card><div className="mt-4 rounded-xl border border-white/[0.055] bg-white/[0.02] p-4 text-[10px] leading-relaxed text-slate-500"><b className="text-slate-300">Bridge fields:</b> API base URL, expected account number, exact broker server, bridge ID, one-time bridge key, and magic number. Keep <code className="text-emerald-200">InpAllowLiveAccount=false</code> for demo testing.</div></section>

        <section id="verify" className="mb-14 scroll-mt-24"><SectionHeading number="03" label="Verification" title="Send one safe test signal" description="Confirm every hop in the chain before you add any automation or raise exposure." /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['01', 'API response', 'Expect HTTP 202 when the signal passes subscription, wallet, bot, and risk checks.'], ['02', 'EA log', 'The Experts tab should show a received command and an execution result.'], ['03', 'Broker retcode', 'Confirm the accepted retcode, order/deal, symbol, lot, and stops on your demo terminal.'], ['04', 'Dashboard', 'See a current bridge heartbeat, position snapshot, trade record, and any eligible fee.']].map(([number, title, description]) => <Card key={number}><CardContent className="p-4"><span className="font-mono text-[9px] text-emerald-200/65">CHECK {number}</span><p className="mt-3 text-xs font-semibold text-slate-200">{title}</p><p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">{description}</p></CardContent></Card>)}</div><CodeCard className="mt-4" title="Direct webhook test" language="bash" code={curlExample} /></section>

        <section className="rounded-2xl border border-rose-300/10 bg-rose-300/[0.025] p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-rose-300/10 bg-rose-300/[0.05] text-rose-200"><ShieldCheck size={16} /></span><div><h2 className="text-sm font-semibold text-rose-100">Risk and execution caveats</h2><ul className="mt-3 space-y-2 text-[10px] leading-relaxed text-rose-100/55"><li>• `max_daily_drawdown` is an absolute realized USD loss limit since 00:00 UTC; it is not a percent of equity and does not include floating loss.</li><li>• The EA panic action closes positions matching its configured magic number, then removes that EA instance. It cannot guarantee broker acceptance or close positions while MT5 is offline.</li><li>• End-to-end latency below 100 ms cannot be guaranteed; TradingView delivery, network, terminal, and broker execution add variable delay.</li><li>• No strategy metric is a promise of future results. Use demo accounts and independently verify all behavior.</li></ul><div className="mt-4"><ButtonLink href="/dashboard" variant="outline" size="sm">Return to dashboard <ArrowRight size={13} /></ButtonLink></div></div></div></section>
      </div>
    </main>
  );
}

function SectionHeading({ number, label, title, description }: { number: string; label: string; title: string; description: string }) {
  return <div className="mb-5"><p className="eyebrow">{number} · {label}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-white">{title}</h2><p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-500">{description}</p></div>;
}

function CodeCard({ title, language, code, className = '' }: { title: string; language: string; code: string; className?: string }) {
  return <Card className={className}><CardHeader className="pb-4"><div><CardTitle>{title}</CardTitle><p className="mt-1 text-[9px] uppercase tracking-[.12em] text-slate-600">{language}</p></div><CopyButton value={code} /></CardHeader><CardContent className="pt-0"><pre className="max-h-[340px] overflow-auto rounded-xl border border-white/[0.055] bg-[#070e17] p-4 font-mono text-[10px] leading-5 text-cyan-100/75">{code}</pre></CardContent></Card>;
}

function VisualStep({ index, title, description }: { index: number; title: string; description: string }) {
  return <div className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] font-mono text-[9px] text-emerald-200">{index}</span><div><p className="text-[10px] font-semibold text-slate-200">{title}</p><p className="mt-1 text-[9px] leading-relaxed text-slate-500">{description}</p></div></div>;
}

function BadgeCount({ completed, total }: { completed: number; total: number }) {
  return <span className="rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-slate-400"><span className="text-emerald-200">{completed}</span> / {total}</span>;
}

function ActivityIcon() { return <Gauge size={28} className="text-emerald-200" />; }
function SignalIcon() { return <Smartphone size={28} className="text-cyan-200" />; }
