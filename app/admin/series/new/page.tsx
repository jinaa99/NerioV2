import type { Metadata } from 'next';
import SeriesForm from '@/components/admin/SeriesForm';
import { requireAdminPage } from '@/server/auth/guards';
import { adminListTagNames, listGenres } from '@/server/data/catalog';

export const metadata: Metadata = { title: 'New series' };

export default async function Page() {
  await requireAdminPage('/admin/series/new');
  const [genres, tags] = await Promise.all([listGenres(), adminListTagNames()]);
  return <SeriesForm allGenres={genres.map(g => g.name)} allTags={tags} />;
}
