import { Suspense } from 'react';
import { Header, SearchOverlay, TabBar } from '@/components/site/Chrome';
import { listGenres } from '@/server/data/catalog';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const genres = await listGenres();
  return (
    <>
      <Header />
      <main className="site-main">{children}</main>
      <Suspense><TabBar /></Suspense>
      <SearchOverlay genres={genres.filter(g => g.count > 0).map(g => ({ slug: g.slug, name: g.name }))} />
    </>
  );
}
