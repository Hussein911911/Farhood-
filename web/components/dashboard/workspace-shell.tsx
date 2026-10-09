'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Activity, ArrowUpRight, BookOpen, ChevronRight, Command, CreditCard,
  LayoutDashboard, LifeBuoy, LogOut, Menu, ShieldCheck, SlidersHorizontal,
  Sparkles, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

const navigation: { label: string; items: { href: string; label: string; icon: LucideIcon; badge?: string }[] }[] = [
  { label: 'Workspace', items: [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/dashboard/accounts', label: 'MT5 accounts', icon: Activity },
    { href: '/dashboard/bots', label: 'Bots & risk', icon: SlidersHorizontal },
  ] },
  { label: 'Discover', items: [
    { href: '/dashboard/marketplace', label: 'Marketplace', icon: Sparkles, badge: 'V1' },
  ] },
  { label: 'Account', items: [
    { href: '/dashboard/security', label: 'API & security', icon: ShieldCheck },
    { href: '/dashboard/billing', label: 'Billing & wallet', icon: CreditCard },
  ] },
];

function NavContents({ pathname, onNavigate, onLogout }: { pathname: string; onNavigate?: () => void; onLogout: () => void }) {
  return (
    <>
      <Link href="/dashboard" onClick={onNavigate} className="mb-10 flex items-center gap-3 px-2">
        <span className="flex size-10 items-center justify-center rounded-[14px] border border-emerald-200/20 bg-emerald-300/[0.10] text-emerald-200 shadow-[0_0_24px_-8px_rgba(110,231,183,.38)]">
          <Command size={20} strokeWidth={2.4} />
        </span>
        <span className="min-w-0">
          <span className="block text-[17px] font-semibold tracking-[-.04em] text-white">farhood<span className="text-emerald-300">.</span></span>
          <span className="block text-[9px] font-semibold uppercase tracking-[.22em] text-slate-600">execution workspace</span>
        </span>
      </Link>

      <div className="space-y-7">
        {navigation.map((group) => (
          <div key={group.label}>
            <p className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[.22em] text-slate-600">{group.label}</p>
            <div className="space-y-1">
              {group.items.map(({ href, label, icon: Icon, badge }) => {
                const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
                return (
                  <Link key={href} href={href} onClick={onNavigate} className={cn(
                    'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition',
                    active ? 'bg-emerald-300/[0.09] text-emerald-100' : 'text-slate-400 hover:bg-white/[0.045] hover:text-slate-100',
                  )}>
                    {active && <span className="absolute -left-px top-2.5 h-5 w-[2px] rounded-full bg-emerald-300" />}
                    <Icon size={16} className={cn(active ? 'text-emerald-300' : 'text-slate-500 group-hover:text-slate-300')} />
                    <span className="flex-1">{label}</span>
                    {badge && <span className="rounded-md border border-emerald-300/15 bg-emerald-300/[0.07] px-1.5 py-0.5 text-[8px] font-bold tracking-[.13em] text-emerald-200">{badge}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-8">
        <Link href="/docs" onClick={onNavigate} className="mb-1 flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-slate-400 transition hover:bg-white/[0.045] hover:text-slate-100">
          <BookOpen size={16} className="text-slate-500" /> Onboarding guide <ArrowUpRight size={13} className="ml-auto text-slate-600" />
        </Link>
        <div className="my-4 border-t border-white/[0.06]" />
        <button onClick={onLogout} className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-slate-500 transition hover:bg-rose-400/[0.07] hover:text-rose-200">
          <LogOut size={16} /> Sign out
        </button>
        <div className="mt-4 flex items-center gap-2 px-3 text-[10px] text-slate-600">
          <span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,.65)]" />
          Secure API proxy enabled
        </div>
      </div>
    </>
  );
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const title = pathname === '/dashboard'
    ? 'Overview'
    : pathname.includes('/accounts') ? 'MT5 accounts'
      : pathname.includes('/bots') ? 'Bots & risk'
        : pathname.includes('/marketplace') ? 'Marketplace'
          : pathname.includes('/security') ? 'API & security'
          : pathname.includes('/billing') ? 'Billing & wallet'
            : 'Plan & wallet';

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col border-r border-white/[0.055] bg-[#09131f]/90 px-4 py-6 backdrop-blur-xl lg:flex">
        <NavContents pathname={pathname} onLogout={signOut} />
        <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-medium text-slate-400"><LifeBuoy size={13} /> Demo-first environment</div>
          <p className="text-[10px] leading-relaxed text-slate-600">Use a demo terminal. Verify every order before connecting a funded account.</p>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="flex h-full w-[min(84vw,300px)] flex-col border-r border-white/10 bg-[#09131f] px-4 py-6" onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex justify-end"><Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></Button></div>
            <NavContents pathname={pathname} onNavigate={() => setMobileOpen(false)} onLogout={signOut} />
          </aside>
        </div>
      )}

      <div className="min-h-screen lg:pl-[244px]">
        <header className="sticky top-0 z-20 border-b border-white/[0.055] bg-[#07101b]/80 backdrop-blur-xl">
          <div className="mx-auto flex h-[68px] max-w-[1600px] items-center justify-between px-4 sm:px-7 lg:px-10">
            <div className="flex items-center gap-3">
              <Button className="lg:hidden" variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></Button>
              <div className="flex items-center gap-2 text-xs text-slate-500"><span className="hidden sm:inline">Workspace</span><ChevronRight size={13} className="hidden sm:block" /><span className="font-medium text-slate-200">{title}</span></div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/docs" className="hidden items-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2 text-[11px] font-medium text-slate-400 transition hover:border-white/[0.15] hover:text-white md:flex"><BookOpen size={14} /> Help center</Link>
              <div className="flex size-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-emerald-200"><Zap size={16} /></div>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 pb-12 pt-7 sm:px-7 sm:pt-9 lg:px-10">{children}</main>
        <footer className="mx-auto flex max-w-[1600px] flex-col gap-2 border-t border-white/[0.045] px-4 py-5 text-[10px] text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-10">
          <span>Farhood · Trading infrastructure, not investment advice.</span>
          <span>Demo first · Latency and trading outcomes are not guaranteed</span>
        </footer>
      </div>
    </div>
  );
}
