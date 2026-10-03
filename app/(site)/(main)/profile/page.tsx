import type { Metadata } from 'next';
import { pageOffset, param } from '@/components/Pager';
import Profile, { type ProfileTabData } from '@/components/site/Profile';
import { isProfileTab, type ProfileTab as Tab } from '@/lib/profile';
import { requireUserPage } from '@/server/auth/guards';
import { getMyProfile } from '@/server/data/account';
import { getLibrarySummary, listMyBookmarks, listMyFollows, listRecentReadTimes } from '@/server/data/library';
import { listNotifications } from '@/server/data/notifications';
import { listContinueReading, listReadingHistory } from '@/server/data/reading';

export const metadata: Metadata = { title: 'Profile' };

/** Only the active tab's data is loaded. */
async function loadTab(tab: Tab, page: string | string[] | undefined): Promise<ProfileTabData> {
  switch (tab) {
    case 'overview': {
      const [continueReading, recentReads] = await Promise.all([listContinueReading({ limit: 3 }), listRecentReadTimes()]);
      return { tab, continueReading: continueReading.items, recentReads };
    }
    case 'bookmarks': return { tab, page: await listMyBookmarks({ limit: 24, offset: pageOffset(page, 24) }) };
    case 'history': return { tab, page: await listReadingHistory({ limit: 40, offset: pageOffset(page, 40) }) };
    case 'following': return { tab, page: await listMyFollows({ limit: 30, offset: pageOffset(page, 30) }) };
    case 'notifications': return { tab, page: await listNotifications({ limit: 20, offset: pageOffset(page, 20) }) };
    default: return { tab };
  }
}

export default async function Page({ searchParams }: PageProps<'/profile'>) {
  const sp = await searchParams;
  const requested = param(sp.tab);
  const tab: Tab = isProfileTab(requested) ? requested : 'overview';
  await requireUserPage(tab === 'overview' ? '/profile' : `/profile?tab=${tab}`);
  const [me, summary, data] = await Promise.all([getMyProfile(), getLibrarySummary(), loadTab(tab, sp.page)]);
  return (
    <Profile
      key={tab}
      account={{ email: me.email, displayName: me.displayName, username: me.username, emailOnNewChapter: me.emailOnNewChapter, showActivity: me.showActivity }}
      summary={summary}
      data={data}
    />
  );
}
