'use client';

import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

export function Switch({ className, ...props }: React.ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root className={cn('relative h-[22px] w-10 rounded-full border border-white/10 bg-slate-700/70 transition data-[state=checked]:border-emerald-400/50 data-[state=checked]:bg-emerald-400/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60 disabled:opacity-50', className)} {...props}>
      <RadixSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[19px]" />
    </RadixSwitch.Root>
  );
}
