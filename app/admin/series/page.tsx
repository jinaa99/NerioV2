import type { Metadata } from 'next';
import SeriesTable from '@/components/admin/SeriesTable';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Series' };

export default async function Page() {
  await requireAdminPage('/admin/series');
  return <SeriesTable />;
}
