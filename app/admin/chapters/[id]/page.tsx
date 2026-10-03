import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ChapterForm from '@/components/admin/ChapterForm';
import { chapterNo } from '@/lib/catalog';
import { requireAdminPage } from '@/server/auth/guards';
import { adminGetChapter } from '@/server/data/catalog';

export async function generateMetadata({ params }: PageProps<'/admin/chapters/[id]'>): Promise<Metadata> {
  const c = await adminGetChapter((await params).id).catch(() => null);
  return { title: c ? `${c.series.title} · Ch. ${chapterNo(c.number)}` : 'Edit chapter' };
}

export default async function Page({ params, searchParams }: PageProps<'/admin/chapters/[id]'>) {
  const { id } = await params;
  await requireAdminPage(`/admin/chapters/${id}`);
  const [chapter, sp] = await Promise.all([adminGetChapter(id), searchParams]);
  if (!chapter) notFound();
  return <ChapterForm key={chapter.id} series={chapter.series} chapter={chapter} justSaved={sp.saved === '1'} />;
}
