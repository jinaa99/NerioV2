import type { Metadata } from 'next';
import { Suspense } from 'react';
import Users from '@/components/admin/Users';

export const metadata: Metadata = { title: 'Users & payments' };

export default function Page() {
  return <Suspense><Users /></Suspense>;
}
