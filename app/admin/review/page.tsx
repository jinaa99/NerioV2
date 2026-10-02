import type { Metadata } from 'next';
import Review from '@/components/admin/Review';

export const metadata: Metadata = { title: 'Translation review' };

export default function Page() {
  return <Review />;
}
