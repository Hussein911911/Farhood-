import type { Metadata } from 'next';
import { SubscriptionPage } from '@/components/pages/subscription-page';

export const metadata: Metadata = { title: 'Subscription & wallet' };

export default function SubscriptionRoute() {
  return <SubscriptionPage />;
}
