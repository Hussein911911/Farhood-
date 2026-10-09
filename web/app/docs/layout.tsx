import { ToastProvider } from '@/components/ui/toast';

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ToastProvider>{children}</ToastProvider>;
}
