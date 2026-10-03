import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import SeriesDetail from '@/components/site/SeriesDetail';
import { getCurrentActor } from '@/server/auth/actor';
import { getSeriesBySlug, listSeries } from '@/server/data/catalog';
import { getMySeriesState } from '@/server/data/library';

// Shared by generateMetadata and the page within one request.
const getSeries = cache(getSeriesBySlug);

export async function generateMetadata({ params }: PageProps<'/series/[id]'>): Promise<Metadata> {
  const s = await getSeries((await params).id);
  return s ? { title: s.title, description: s.description.slice(0, 300) || undefined } : {};
}

export default async function Page({ params }: PageProps<'/series/[id]'>) {
  const s = await getSeries((await params).id);
  if (!s) notFound();
  const [similar, library] = await Promise.all([
    s.genres[0] ? listSeries({ genre: s.genres[0].slug, excludeId: s.id, sort: 'popular', limit: 6 }).then(r => r.items) : Promise.resolve([]),
    (await getCurrentActor()) ? getMySeriesState(s.id) : Promise.resolve(null),
  ]);
  return <SeriesDetail key={s.id} s={s} similar={similar} following={library?.following ?? false} />;
}
