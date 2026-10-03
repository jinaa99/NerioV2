import type { Metadata } from 'next';
import Reports from '@/components/admin/Reports';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Reports' };

export default async function Page() {
  await requireAdminPage('/admin/reports');
  return <Reports />;
}
