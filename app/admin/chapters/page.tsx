import type { Metadata } from 'next';
import { Suspense } from 'react';
import Chapters from '@/components/admin/Chapters';

export const metadata: Metadata = { title: 'Chapters' };

export default function Page() {
  return <Suspense><Chapters /></Suspense>;
}
