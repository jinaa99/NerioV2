import { SiteProvider } from '@/components/site/store';
import './site.css';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteProvider>{children}</SiteProvider>;
}
