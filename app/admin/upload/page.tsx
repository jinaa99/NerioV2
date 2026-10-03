import type { Metadata } from 'next';
import Upload from '@/components/admin/Upload';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Upload chapter' };

export default async function Page() {
  await requireAdminPage('/admin/upload');
  return <Upload />;
}
