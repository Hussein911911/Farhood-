import type { Metadata } from 'next';
import { BillingPage } from '@/components/pages/billing-page';

export const metadata: Metadata = { title: 'Billing & wallet' };

export default function BillingRoute() {
  return <BillingPage />;
}
