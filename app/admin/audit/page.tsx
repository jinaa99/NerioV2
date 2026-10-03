import type { Metadata } from 'next';
import Audit from '@/components/admin/Audit';
import { pageOffset, param } from '@/components/Pager';
import { requireAdminPage } from '@/server/auth/guards';
import { AUDIT_AREAS, listAuditLogs, type AuditArea } from '@/server/data/audit';

export const metadata: Metadata = { title: 'Audit log' };
const LIMIT = 50;

export default async function Page({ searchParams }: PageProps<'/admin/audit'>) {
  await requireAdminPage('/admin/audit');
  const sp = await searchParams;
  const a = param(sp.area);
  const area = (AUDIT_AREAS as readonly string[]).includes(a ?? '') ? (a as AuditArea) : '';
  const q = (param(sp.q) ?? '').slice(0, 100);
  const data = await listAuditLogs({ area: area || undefined, q: q || undefined, limit: LIMIT, offset: pageOffset(sp.page, LIMIT) });
  return <Audit data={data} area={area} q={q} />;
}
