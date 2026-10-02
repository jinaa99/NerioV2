import type { Metadata } from 'next';
import Upload from '@/components/admin/Upload';

export const metadata: Metadata = { title: 'Upload chapter' };

export default function Page() {
  return <Upload />;
}
