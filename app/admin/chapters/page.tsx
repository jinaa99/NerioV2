import type { Metadata } from 'next';
import Chapters, { type ChapterFilter } from '@/components/admin/Chapters';
import { pageOffset, param } from '@/components/Pager';
import { uuid } from '@/lib/validation';
import { requireAdminPage } from '@/server/auth/guards';
import { adminGetSeries, adminListChapters, adminSeriesOptions } from '@/server/data/catalog';

export const metadata: Metadata = { title: 'Chapters' };
const LIMIT = 50;
const FILTERS = new Set<ChapterFilter>(['published', 'scheduled', 'draft', 'pipeline']);

export default async function Page({ searchParams }: PageProps<'/admin/chapters'>) {
  await requireAdminPage('/admin/chapters');
  const sp = await searchParams;
  const options = await adminSeriesOptions();
  const requested = uuid.safeParse(param(sp.series)).data;
  const seriesId = requested ?? options[0]?.id;
  const status = (FILTERS.has(param(sp.status) as ChapterFilter) ? param(sp.status) : '') as ChapterFilter;

  const [series, data] = seriesId
    ? await Promise.all([
      adminGetSeries(seriesId),
      adminListChapters({ seriesId, status: status || undefined, limit: LIMIT, offset: pageOffset(sp.page, LIMIT) }),
    ])
    : [null, null];

  return (
    <Chapters
      options={options}
      series={series && { id: series.id, title: series.title, slug: series.slug }}
      data={series ? data : null}
      status={status}
    />
  );
}
