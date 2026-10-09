import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Farhood — Trading Workspace', template: '%s · Farhood' },
  description: 'A secure workspace for TradingView-to-MT5 automation, account risk, and strategy operations.',
  applicationName: 'Farhood',
};

export const viewport: Viewport = {
  themeColor: '#07101b',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
