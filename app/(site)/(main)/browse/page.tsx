import type { Metadata } from 'next';
import { pageOffset, param } from '@/components/Pager';
import Browse, { type BrowseFilters } from '@/components/site/Browse';
import { seriesSort, slug } from '@/lib/validation';
import { listGenres, listSeries } from '@/server/data/catalog';

const LIMIT = 24;

export async function generateMetadata({ searchParams }: PageProps<'/browse'>): Promise<Metadata> {
  const sp = await searchParams;
  const q = param(sp.q);
  return { title: q ? `Search: ${q.slice(0, 60)}` : 'Browse series', description: 'Browse, search and filter translated manhwa on Nerio.' };
}

export default async function Page({ searchParams }: PageProps<'/browse'>) {
  const sp = await searchParams;
  const filters: BrowseFilters = {
    q: (param(sp.q) ?? '').trim().slice(0, 100),
    genre: slug.safeParse(param(sp.genre)).data ?? '',
    status: (['ongoing', 'completed', 'hiatus'] as const).find(s => s === param(sp.status)) ?? '',
    sort: seriesSort.safeParse(param(sp.sort)).data ?? 'popular',
  };
  const [data, genres] = await Promise.all([
    listSeries({
      q: filters.q || undefined, genre: filters.genre || undefined, status: filters.status || undefined, sort: filters.sort,
      limit: LIMIT, offset: pageOffset(sp.page, LIMIT),
    }),
    listGenres(),
  ]);
  return <Browse data={data} filters={filters} genres={genres.filter(g => g.count > 0 || g.slug === filters.genre)} />;
}
