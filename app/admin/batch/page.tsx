import type { Metadata } from 'next';
import BatchUpload from '@/components/admin/BatchUpload';
import { requireAdminPage } from '@/server/auth/guards';
import { adminSeriesOptions } from '@/server/data/catalog';
import { listBatchChapters } from '@/server/data/manual-translation';
import { getSettings } from '@/server/data/settings';
import { serverEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Batch translate' };

export default async function Page() {
  await requireAdminPage('/admin/batch');
  const [options, rows, settings] = await Promise.all([adminSeriesOptions(), listBatchChapters(), getSettings()]);
  return <BatchUpload options={options} rows={rows} paused={settings.pausePipeline} autoPublish={serverEnv().AUTO_PUBLISH_TRANSLATED_CHAPTERS} />;
}
