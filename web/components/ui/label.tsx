import * as RadixLabel from '@radix-ui/react-label';
import { cn } from '@/lib/cn';

export function Label({ className, ...props }: React.ComponentProps<typeof RadixLabel.Root>) {
  return <RadixLabel.Root className={cn('mb-2 block text-xs font-medium text-slate-300', className)} {...props} />;
}
