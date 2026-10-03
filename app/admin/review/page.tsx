import type { Metadata } from 'next';
import Review from '@/components/admin/Review';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Translation review' };

export default async function Page() {
  await requireAdminPage('/admin/review');
  return <Review />;
}
