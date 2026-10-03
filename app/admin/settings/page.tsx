import type { Metadata } from 'next';
import Settings from '@/components/admin/Settings';
import { requireAdminPage } from '@/server/auth/guards';
import { getSettings } from '@/server/data/settings';

export const metadata: Metadata = { title: 'Settings' };

export default async function Page() {
  await requireAdminPage('/admin/settings');
  return <Settings settings={await getSettings()} />;
}
