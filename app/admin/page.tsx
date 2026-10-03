import Overview from '@/components/admin/Overview';
import { requireAdminPage } from '@/server/auth/guards';
import { getDashboard } from '@/server/data/dashboard';

export default async function Page() {
  await requireAdminPage('/admin');
  return <Overview d={await getDashboard()} />;
}
