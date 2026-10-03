import { redirect } from 'next/navigation';
import { requireAdminPage } from '@/server/auth/guards';

/** Review always targets a job; pick one from the queue. */
export default async function Page() {
  await requireAdminPage('/admin/review');
  redirect('/admin/queue');
}
