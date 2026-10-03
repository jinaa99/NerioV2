import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import Reader from '@/components/site/Reader';
import { chapterName, chapterNo } from '@/lib/catalog';
import { getChapterForReader } from '@/server/data/catalog';

const getChapter = cache(async (slug: string, ch: string) => {
  const n = Number(ch);
  return /^\d+(\.\d{1,2})?$/.test(ch) && Number.isFinite(n) ? getChapterForReader(slug, n) : null;
});

export async function generateMetadata({ params }: PageProps<'/read/[id]/[ch]'>): Promise<Metadata> {
  const { id, ch } = await params;
  const c = await getChapter(id, ch);
  return c ? { title: `${c.series.title} · Ch. ${chapterNo(c.number)}${c.title ? ` ${chapterName(c.number, c.title)}` : ''}` } : {};
}

export default async function Page({ params }: PageProps<'/read/[id]/[ch]'>) {
  const { id, ch } = await params;
  const chapter = await getChapter(id, ch);
  if (!chapter) notFound();
  // Keyed so each chapter starts with fresh loading/scroll state.
  return <Reader key={chapter.id} chapter={chapter} />;
}
