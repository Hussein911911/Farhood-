import type { Metadata } from 'next';
import { BotsPage } from '@/components/pages/bots-page';

export const metadata: Metadata = { title: 'Bots & risk' };

export default function BotsRoute() {
  return <BotsPage />;
}
