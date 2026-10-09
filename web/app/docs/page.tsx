import type { Metadata } from 'next';
import { DocsPage } from '@/components/pages/docs-page';

export const metadata: Metadata = { title: 'Setup & onboarding' };

export default function DocsRoute() {
  return <DocsPage />;
}
