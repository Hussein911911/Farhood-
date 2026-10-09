import { cn } from '@/lib/cn';

export function PageHeading({ eyebrow, title, description, action, className }: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div>
        {eyebrow && <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.22em] text-emerald-300/75">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-[-.035em] text-white sm:text-[30px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
