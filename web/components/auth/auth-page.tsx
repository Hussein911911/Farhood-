'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Check, Eye, EyeOff, LockKeyhole, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const isRegister = mode === 'register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (isRegister && password !== confirmPassword) {
      setError('Your passwords do not match.');
      return;
    }
    setPending(true);
    try {
      const response = await fetch(isRegister ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const validation: Record<string, string> = {
          invalid_credentials: 'Email or password is incorrect.',
          invalid_email: 'Enter a valid email address.',
          invalid_password: 'Password must contain 12 to 128 characters.',
          duplicate_resource: 'An account already exists for this email.',
          backend_unavailable: 'The authentication API is not reachable. Check the backend connection.',
        };
        throw new Error(validation[payload.error] || payload.message || payload.error || 'Unable to continue. Please try again.');
      }
      if (isRegister) {
        setSuccess('Your workspace is ready. Sign in to configure your MT5 account and risk settings.');
        setPassword('');
        setConfirmPassword('');
      } else {
        router.replace('/dashboard');
        router.refresh();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to continue. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <div className="subtle-grid pointer-events-none absolute inset-0 opacity-45" />
      <div className="pointer-events-none absolute -left-40 top-[-10rem] size-[30rem] rounded-full bg-emerald-400/[0.06] blur-[110px]" />
      <div className="relative grid w-full max-w-[1050px] overflow-hidden rounded-[28px] border border-white/[0.085] bg-[#0b1521]/90 shadow-[0_35px_120px_-45px_rgba(0,0,0,.85)] lg:grid-cols-[.95fr_1.05fr]">
        <section className="relative hidden min-h-[660px] flex-col justify-between overflow-hidden border-r border-white/[0.06] bg-[#0b1723] p-10 lg:flex xl:p-12">
          <div className="subtle-grid absolute inset-0 opacity-40" />
          <div className="absolute -right-24 top-12 size-72 rounded-full bg-emerald-400/[0.07] blur-[85px]" />
          <Link href="/" className="relative flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[14px] border border-emerald-200/20 bg-emerald-300/[0.10] text-emerald-200"><Zap size={19} /></span>
            <span className="text-[18px] font-semibold tracking-[-.04em] text-white">farhood<span className="text-emerald-300">.</span></span>
          </Link>
          <div className="relative max-w-md">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.15em] text-emerald-200"><Sparkles size={13} /> Trading operations, connected</span>
            <h1 className="text-[40px] font-semibold leading-[1.13] tracking-[-.05em] text-white xl:text-[48px]">Your strategies.<br /><span className="text-emerald-300">One clear</span> workspace.</h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">Link your TradingView alerts to MT5, shape risk controls, and see every execution in one calm command center.</p>
            <div className="mt-10 space-y-3">
              {[
                ['01', 'Private by design', 'One-time keys and httpOnly sessions'],
                ['02', 'Know what is running', 'Bridge health and account-level status'],
                ['03', 'Risk comes first', 'Daily limits, lot guards, and emergency stop'],
              ].map(([number, title, sub]) => (
                <div key={number} className="flex items-center gap-4 rounded-2xl border border-white/[0.05] bg-white/[0.025] p-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.045] font-mono text-[10px] text-emerald-200">{number}</span>
                  <div><p className="text-xs font-semibold text-slate-200">{title}</p><p className="mt-1 text-[10px] text-slate-500">{sub}</p></div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative flex items-center justify-between text-[10px] text-slate-600"><span>Demo-first infrastructure</span><span>Latency is network-dependent</span></div>
        </section>

        <section className="flex min-h-[660px] flex-col justify-center p-6 sm:p-10 lg:p-12 xl:p-14">
          <div className="mb-9 flex items-center justify-between lg:hidden">
            <Link href="/" className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl border border-emerald-200/20 bg-emerald-300/[0.1] text-emerald-200"><Zap size={17} /></span><span className="font-semibold tracking-tight text-white">farhood<span className="text-emerald-300">.</span></span></Link>
            <Link href="/docs" className="text-xs text-slate-400 hover:text-white">Setup guide <ArrowRight size={12} className="ml-1 inline" /></Link>
          </div>
          <div className="mb-8">
            <div className="mb-4 flex size-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] text-emerald-200"><LockKeyhole size={19} /></div>
            <p className="eyebrow mb-2">{isRegister ? 'Create your workspace' : 'Welcome back'}</p>
            <h2 className="text-[28px] font-semibold tracking-[-.04em] text-white">{isRegister ? 'Start with a secure account' : 'Sign in to Farhood'}</h2>
            <p className="mt-2 text-sm text-slate-500">{isRegister ? 'Register first, then connect your MT5 demo account.' : 'Your control room for every connection and strategy.'}</p>
          </div>

          {success && <div role="status" className="mb-5 flex gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] p-3 text-xs leading-relaxed text-emerald-100"><Check size={15} className="mt-0.5 shrink-0" />{success}</div>}
          {error && <div role="alert" className="mb-5 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] p-3 text-xs leading-relaxed text-rose-100">{error}</div>}

          <form className="space-y-5" onSubmit={submit}>
            <div><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <div>
              <div className="flex items-center justify-between"><Label htmlFor="password">Password</Label>{!isRegister && <span className="mb-2 text-[10px] text-slate-600">12+ characters</span>}</div>
              <div className="relative">
                <Input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={isRegister ? 12 : 1} maxLength={128} placeholder={isRegister ? 'Create a strong password' : 'Enter your password'} className="pr-12" value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-3 flex items-center text-slate-500 hover:text-slate-200">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
            {isRegister && <div><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" name="confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} placeholder="Re-enter your password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>}
            <Button type="submit" size="lg" disabled={pending} className="mt-2 w-full">{pending ? 'Please wait…' : isRegister ? 'Create secure workspace' : 'Continue to dashboard'} {!pending && <ArrowRight size={16} />}</Button>
          </form>

          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-white/[0.055] bg-white/[0.02] p-3.5 text-[10px] leading-relaxed text-slate-500"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-slate-400" /><span>Sessions use an HttpOnly, SameSite cookie (Secure in production). We never expose your bearer token to browser JavaScript.</span></div>
          <div className="mt-7 text-center text-xs text-slate-500">
            {isRegister ? <>Already have an account? <Link href="/login" className="font-semibold text-emerald-200 hover:text-emerald-100">Sign in</Link></> : <>New to Farhood? <Link href="/register" className="font-semibold text-emerald-200 hover:text-emerald-100">Create an account</Link></>}
          </div>
          <div className="mt-auto pt-12 text-center text-[10px] text-slate-700 lg:hidden">Always validate on an MT5 demo account before going live.</div>
        </section>
      </div>
    </main>
  );
}
