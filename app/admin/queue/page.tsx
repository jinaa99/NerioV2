import type { Metadata } from 'next';
import Queue from '@/components/admin/Queue';
import { pageOffset } from '@/components/Pager';
import { requireAdminPage } from '@/server/auth/guards';
import { listReviewQueue } from '@/server/data/pipeline';
import { getSettings } from '@/server/data/settings';

export const metadata: Metadata = { title: 'Translation queue' };
const LIMIT = 20;

export default async function Page({ searchParams }: PageProps<'/admin/queue'>) {
  await requireAdminPage('/admin/queue');
  const sp = await searchParams;
  const [data, settings] = await Promise.all([listReviewQueue({ limit: LIMIT, offset: pageOffset(sp.page, LIMIT) }), getSettings()]);
  return <Queue data={data} threshold={settings.autoPublishThreshold} />;
}
