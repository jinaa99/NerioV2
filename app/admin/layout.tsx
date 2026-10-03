import type { Metadata } from 'next';
import AdminShell from '@/components/admin/Shell';
import { AdminProvider } from '@/components/admin/store';
import { getViewer, requireAdminPage } from '@/server/auth/guards';
import { getAdminNavCounts } from '@/server/data/dashboard';
import './admin.css';

export const metadata: Metadata = { title: { default: 'Nerio Admin', template: '%s · Nerio Admin' } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Server-side gate for every /admin page. Admin data access is also checked in the DAL.
  await requireAdminPage();
  const [viewer, counts] = await Promise.all([getViewer(), getAdminNavCounts()]);
  return (
    <AdminProvider>
      <AdminShell initials={viewer?.initials ?? '?'} counts={counts}>{children}</AdminShell>
    </AdminProvider>
  );
}
