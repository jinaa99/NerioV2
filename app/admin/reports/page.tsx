import type { Metadata } from 'next';
import Reports from '@/components/admin/Reports';

export const metadata: Metadata = { title: 'Reports' };

export default function Page() {
  return <Reports />;
}
