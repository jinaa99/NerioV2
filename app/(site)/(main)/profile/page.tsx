import type { Metadata } from 'next';
import { Suspense } from 'react';
import Profile from '@/components/site/Profile';

export const metadata: Metadata = { title: 'Profile' };

export default function Page() {
  return <Suspense><Profile /></Suspense>;
}
