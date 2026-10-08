'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error' | 'info';
type ToastMessage = { id: number; title: string; description?: string; kind: ToastKind };
type ToastContextValue = { toast: (message: Omit<ToastMessage, 'id'>) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastMessage[]>([]);
  const toast = useCallback((message: Omit<ToastMessage, 'id'>) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((current) => [...current, { ...message, id }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4600);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite" aria-atomic="false">
        {items.map((item) => {
          const Icon = item.kind === 'success' ? CheckCircle2 : item.kind === 'error' ? CircleAlert : Info;
          return (
            <div key={item.id} className="flex gap-3 rounded-xl border border-white/10 bg-[#101c2a]/95 p-4 shadow-2xl backdrop-blur-xl">
              <Icon size={18} className={cn('mt-0.5 shrink-0', item.kind === 'success' ? 'text-emerald-300' : item.kind === 'error' ? 'text-rose-300' : 'text-cyan-300')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{item.title}</p>
                {item.description && <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.description}</p>}
              </div>
              <button className="self-start text-slate-500 hover:text-white" onClick={() => setItems((current) => current.filter((toast) => toast.id !== item.id))} aria-label="Dismiss notification"><X size={15} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
