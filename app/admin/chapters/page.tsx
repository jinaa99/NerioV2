import type { Metadata } from 'next';
import { Suspense } from 'react';
import Chapters from '@/components/admin/Chapters';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Chapters' };

export default async function Page() {
  await requireAdminPage('/admin/chapters');
  return <Suspense><Chapters /></Suspense>;
}
