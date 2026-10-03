import type { Metadata } from 'next';
import SeriesTable from '@/components/admin/SeriesTable';
import { pageOffset, param } from '@/components/Pager';
import { seriesStatus } from '@/lib/validation';
import { requireAdminPage } from '@/server/auth/guards';
import { adminListSeries } from '@/server/data/catalog';

export const metadata: Metadata = { title: 'Series' };
const LIMIT = 25;

export default async function Page({ searchParams }: PageProps<'/admin/series'>) {
  await requireAdminPage('/admin/series');
  const sp = await searchParams;
  const q = (param(sp.q) ?? '').slice(0, 100);
  const status = seriesStatus.safeParse(param(sp.status)).data;
  const data = await adminListSeries({ q: q || undefined, status, limit: LIMIT, offset: pageOffset(sp.page, LIMIT) });
  return <SeriesTable data={data} q={q} status={status ?? ''} />;
}
