import type { Metadata } from 'next';
import Premium from '@/components/site/Premium';

export const metadata: Metadata = { title: 'Premium' };

export default function Page() {
  return <Premium />;
}
