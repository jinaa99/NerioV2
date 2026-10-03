import type { Metadata } from 'next';
import { Suspense } from 'react';
import Profile from '@/components/site/Profile';
import { requireUserPage } from '@/server/auth/guards';
import { getMyProfile } from '@/server/data/account';

export const metadata: Metadata = { title: 'Profile' };

export default async function Page() {
  await requireUserPage('/profile');
  const me = await getMyProfile();
  return <Suspense><Profile account={{ email: me.email, displayName: me.displayName, username: me.username }} /></Suspense>;
}
