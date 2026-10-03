import type { Metadata } from 'next';
import { Suspense } from 'react';
import Users from '@/components/admin/Users';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Users & payments' };

export default async function Page() {
  await requireAdminPage('/admin/users');
  return <Suspense><Users /></Suspense>;
}
