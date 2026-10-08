import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { WorkspaceShell } from '@/components/dashboard/workspace-shell';
import { ToastProvider } from '@/components/ui/toast';
import { SESSION_COOKIE } from '@/lib/auth';

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  return (
    <ToastProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </ToastProvider>
  );
}
