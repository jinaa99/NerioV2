import type { Metadata } from 'next';
import Processing from '@/components/admin/Processing';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Processing' };

export default async function Page() {
  await requireAdminPage('/admin/processing');
  return <Processing />;
}
