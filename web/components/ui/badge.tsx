import { cn } from '@/lib/cn';

const tones = {
  green: 'border-emerald-300/15 bg-emerald-300/[0.09] text-emerald-200',
  red: 'border-rose-300/15 bg-rose-300/[0.08] text-rose-200',
  amber: 'border-amber-300/15 bg-amber-300/[0.08] text-amber-200',
  blue: 'border-cyan-300/15 bg-cyan-300/[0.08] text-cyan-200',
  violet: 'border-violet-300/15 bg-violet-300/[0.08] text-violet-200',
  neutral: 'border-white/[0.09] bg-white/[0.04] text-slate-300',
} as const;

export function Badge({ tone = 'neutral', className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.1em]', tones[tone], className)} {...props} />;
}
