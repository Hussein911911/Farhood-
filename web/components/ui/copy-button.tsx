'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ kind: 'success', title: 'Copied to clipboard' });
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ kind: 'error', title: 'Clipboard unavailable', description: 'Select and copy this value manually.' });
    }
  }
  return (
    <Button size="sm" variant="secondary" onClick={copy} aria-label={label}>
      {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
      <span>{copied ? 'Copied' : label}</span>
    </Button>
  );
}
