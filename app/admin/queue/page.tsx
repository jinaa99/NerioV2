import type { Metadata } from 'next';
import Queue from '@/components/admin/Queue';

export const metadata: Metadata = { title: 'Translation queue' };

export default function Page() {
  return <Queue />;
}
