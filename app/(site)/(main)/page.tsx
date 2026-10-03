import type { Metadata } from 'next';
import Home, { type HomeData } from '@/components/site/Home';
import { getCurrentActor } from '@/server/auth/actor';
import { latestChapters, listGenres, listSeries } from '@/server/data/catalog';
import { listContinueReading } from '@/server/data/reading';

export const metadata: Metadata = { alternates: { canonical: '/' } };

export default async function Page() {
  const actor = await getCurrentActor();
  const [popular, rated, updated, fresh, genres, continueReading] = await Promise.all([
    listSeries({ sort: 'popular', limit: 12 }),
    listSeries({ sort: 'rating', limit: 12 }),
    listSeries({ sort: 'updated', limit: 6 }),
    listSeries({ sort: 'new', limit: 12 }),
    listGenres(),
    actor ? listContinueReading({ limit: 4 }).then(r => r.items) : Promise.resolve([]),
  ]);
  const recent = await latestChapters(updated.items.map(s => s.id), 2);
  const featured = popular.items.slice(0, 3);

  const data: HomeData = {
    featured,
    trending: popular.items.slice(0, 6),
    updated: updated.items.filter(s => s.chapterCount > 0).map(s => ({ ...s, recent: recent.get(s.id) ?? [] })),
    fresh: fresh.items,
    popular: [popular.items, rated.items, fresh.items],
    pick: rated.items.find(s => !featured.some(f => f.id === s.id)) ?? null,
    genres: genres.filter(g => g.count > 0),
    continueReading,
  };
  return <Home data={data} />;
}
