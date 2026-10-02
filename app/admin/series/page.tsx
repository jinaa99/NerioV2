import type { Metadata } from 'next';
import SeriesTable from '@/components/admin/SeriesTable';

export const metadata: Metadata = { title: 'Series' };

export default function Page() {
  return <SeriesTable />;
}
