'use client';

import Link from 'next/link';
import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const buttonStyles = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07101b] disabled:pointer-events-none disabled:opacity-45 active:translate-y-px',
  {
    variants: {
      variant: {
        primary: 'bg-emerald-400 text-[#07110e] shadow-[0_0_28px_-12px_rgba(52,211,153,.75)] hover:bg-emerald-300',
        secondary: 'border border-white/[0.10] bg-white/[0.06] text-slate-100 hover:border-white/[0.16] hover:bg-white/[0.10]',
        outline: 'border border-white/[0.12] bg-transparent text-slate-200 hover:border-white/25 hover:bg-white/[0.05]',
        ghost: 'text-slate-400 hover:bg-white/[0.06] hover:text-white',
        danger: 'border border-rose-400/20 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20',
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        md: 'h-10 px-4',
        lg: 'h-12 px-5',
        icon: 'size-10 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
});

export function ButtonLink({ className, variant, size, ...props }: React.ComponentProps<typeof Link> & VariantProps<typeof buttonStyles>) {
  return <Link className={buttonStyles({ variant, size, className })} {...props} />;
}
