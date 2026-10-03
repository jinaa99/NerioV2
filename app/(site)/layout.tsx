import { SiteProvider } from '@/components/site/store';
import { getViewer } from '@/server/auth/guards';
import './site.css';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Only touches the database when a session cookie is present.
  const viewer = await getViewer();
  return <SiteProvider viewer={viewer}>{children}</SiteProvider>;
}
