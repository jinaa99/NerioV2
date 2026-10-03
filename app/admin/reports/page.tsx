import type { Metadata } from 'next';
import Reports from '@/components/admin/Reports';
import { pageOffset, param } from '@/components/Pager';
import { requireAdminPage } from '@/server/auth/guards';
import { listReports, type ReportStatus } from '@/server/data/reports';

export const metadata: Metadata = { title: 'Reports' };
const LIMIT = 25;

export default async function Page({ searchParams }: PageProps<'/admin/reports'>) {
  await requireAdminPage('/admin/reports');
  const sp = await searchParams;
  const s = param(sp.status);
  const status: ReportStatus = s === 'resolved' || s === 'dismissed' ? s : 'open';
  return <Reports data={await listReports({ status, limit: LIMIT, offset: pageOffset(sp.page, LIMIT) })} status={status} />;
}
