import Overview from '@/components/admin/Overview';
import { requireAdminPage } from '@/server/auth/guards';

export default async function Page() {
  await requireAdminPage('/admin');
  return <Overview />;
}
