import type { Metadata } from 'next';
import Upload from '@/components/admin/Upload';
import { param } from '@/components/Pager';
import { requireAdminPage } from '@/server/auth/guards';
import { adminSeriesOptions } from '@/server/data/catalog';

export const metadata: Metadata = { title: 'Upload chapter' };

export default async function Page({ searchParams }: PageProps<'/admin/upload'>) {
  await requireAdminPage('/admin/upload');
  const [options, sp] = await Promise.all([adminSeriesOptions(), searchParams]);
  return <Upload options={options} initialSeries={param(sp.series)} />;
}
