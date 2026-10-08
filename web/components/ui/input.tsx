'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return <input ref={ref} type={type} className={cn('field h-11 w-full rounded-xl border border-white/[0.09] bg-[#09121d] px-3.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-emerald-400/55 focus:ring-4 focus:ring-emerald-400/[0.07] disabled:opacity-50', className)} {...props} />;
});

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('field min-h-24 w-full resize-y rounded-xl border border-white/[0.09] bg-[#09121d] px-3.5 py-3 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-emerald-400/55 focus:ring-4 focus:ring-emerald-400/[0.07]', className)} {...props} />;
}

export function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('field h-11 w-full rounded-xl border border-white/[0.09] bg-[#09121d] px-3.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/55 focus:ring-4 focus:ring-emerald-400/[0.07]', className)} {...props} />;
}
