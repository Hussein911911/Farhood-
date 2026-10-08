import type { Metadata } from 'next';
import { SecurityPage } from '@/components/pages/security-page';

export const metadata: Metadata = { title: 'API keys & security' };

export default function SecurityRoute() {
  return <SecurityPage />;
}
