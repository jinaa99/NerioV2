import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SeriesForm from '@/components/admin/SeriesForm';
import { requireAdminPage } from '@/server/auth/guards';
import { adminGetSeries, adminListTagNames, listGenres } from '@/server/data/catalog';

export async function generateMetadata({ params }: PageProps<'/admin/series/[id]'>): Promise<Metadata> {
  const s = await adminGetSeries((await params).id).catch(() => null);
  return { title: s ? `Edit · ${s.title}` : 'Edit series' };
}

export default async function Page({ params, searchParams }: PageProps<'/admin/series/[id]'>) {
  const { id } = await params;
  await requireAdminPage(`/admin/series/${id}`);
  const [series, genres, tags, sp] = await Promise.all([adminGetSeries(id), listGenres(), adminListTagNames(), searchParams]);
  if (!series) notFound();
  // Keyed so navigating between series resets the form state.
  return <SeriesForm key={series.id} series={series} allGenres={genres.map(g => g.name)} allTags={tags} justSaved={sp.saved === '1'} />;
}
