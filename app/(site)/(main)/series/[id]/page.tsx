import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SeriesDetail from '@/components/site/SeriesDetail';
import { SERIES, getSeries } from '@/lib/data';

export function generateStaticParams() {
  return SERIES.map(s => ({ id: s.id }));
}

export async function generateMetadata({ params }: PageProps<'/series/[id]'>): Promise<Metadata> {
  const s = getSeries((await params).id);
  return s ? { title: s.title, description: s.desc } : {};
}

export default async function Page({ params }: PageProps<'/series/[id]'>) {
  const { id } = await params;
  if (!getSeries(id)) notFound();
  return <SeriesDetail id={id} />;
}
