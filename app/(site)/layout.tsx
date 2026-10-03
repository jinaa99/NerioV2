import { SiteProvider } from '@/components/site/store';
import { getViewer } from '@/server/auth/guards';
import { listMyBookmarkedSlugs } from '@/server/data/library';
import './site.css';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Only touches the database when a session cookie is present.
  const viewer = await getViewer();
  const bookmarkedSlugs = viewer ? await listMyBookmarkedSlugs() : [];
  return <SiteProvider viewer={viewer} bookmarkedSlugs={bookmarkedSlugs}>{children}</SiteProvider>;
}
