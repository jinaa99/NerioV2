import type { Metadata } from 'next';
import Processing from '@/components/admin/Processing';
import { pageOffset, param } from '@/components/Pager';
import { requireAdminPage } from '@/server/auth/guards';
import { JOB_FILTERS, jobCounts, listJobs, type JobFilter } from '@/server/data/pipeline';
import { getSettings } from '@/server/data/settings';

export const metadata: Metadata = { title: 'Processing' };
const LIMIT = 20;

export default async function Page({ searchParams }: PageProps<'/admin/processing'>) {
  await requireAdminPage('/admin/processing');
  const sp = await searchParams;
  const requested = param(sp.filter);
  const filter: JobFilter = (JOB_FILTERS as readonly string[]).includes(requested ?? '') ? (requested as JobFilter) : 'all';
  const [data, counts, settings] = await Promise.all([listJobs({ filter, limit: LIMIT, offset: pageOffset(sp.page, LIMIT) }), jobCounts(), getSettings()]);
  return <Processing data={data} filter={filter} counts={counts} paused={settings.pausePipeline} />;
}
