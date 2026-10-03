import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import ChapterForm from '@/components/admin/ChapterForm';
import { param } from '@/components/Pager';
import { requireAdminPage } from '@/server/auth/guards';
import { adminGetSeries, adminNextChapterNumber } from '@/server/data/catalog';

export const metadata: Metadata = { title: 'New chapter' };

export default async function Page({ searchParams }: PageProps<'/admin/chapters/new'>) {
  await requireAdminPage('/admin/chapters');
  const seriesId = param((await searchParams).series);
  if (!seriesId) redirect('/admin/chapters');
  const series = await adminGetSeries(seriesId);
  if (!series) notFound();
  const nextNumber = await adminNextChapterNumber(series.id);
  return <ChapterForm series={{ id: series.id, title: series.title, slug: series.slug }} nextNumber={nextNumber} />;
}
