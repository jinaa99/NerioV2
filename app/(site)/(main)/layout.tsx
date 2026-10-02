import { Suspense } from 'react';
import { Header, SearchOverlay, TabBar } from '@/components/site/Chrome';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="site-main">{children}</main>
      <Suspense><TabBar /></Suspense>
      <SearchOverlay />
    </>
  );
}
