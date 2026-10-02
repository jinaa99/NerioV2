import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Reader from '@/components/site/Reader';
import { chapterTitle, getSeries } from '@/lib/data';

export async function generateMetadata({ params }: PageProps<'/read/[id]/[ch]'>): Promise<Metadata> {
  const { id, ch } = await params;
  const s = getSeries(id);
  return s ? { title: `${s.title} · Ch. ${ch} ${chapterTitle(+ch)}` } : {};
}

export default async function Page({ params }: PageProps<'/read/[id]/[ch]'>) {
  const { id, ch } = await params;
  const s = getSeries(id);
  const n = Number(ch);
  if (!s || !Number.isInteger(n) || n < 1 || n > s.ch) notFound();
  // Keyed so each chapter starts with fresh loading/scroll state.
  return <Reader key={`${id}-${n}`} id={id} ch={n} />;
}
