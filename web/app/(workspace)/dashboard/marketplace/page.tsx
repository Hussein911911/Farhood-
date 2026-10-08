import type { Metadata } from 'next';
import { MarketplacePage } from '@/components/pages/marketplace-page';

export const metadata: Metadata = { title: 'Strategy marketplace' };

export default function MarketplaceRoute() {
  return <MarketplacePage />;
}
