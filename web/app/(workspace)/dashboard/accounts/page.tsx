import type { Metadata } from 'next';
import { AccountsPage } from '@/components/pages/accounts-page';

export const metadata: Metadata = { title: 'MT5 accounts' };

export default function AccountsRoute() {
  return <AccountsPage />;
}
