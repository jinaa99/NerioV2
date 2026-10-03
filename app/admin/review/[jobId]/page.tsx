import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Review from '@/components/admin/Review';
import { requireAdminPage } from '@/server/auth/guards';
import { getReviewJob } from '@/server/data/pipeline';

export const metadata: Metadata = { title: 'Translation review' };

export default async function Page({ params }: PageProps<'/admin/review/[jobId]'>) {
  const { jobId } = await params;
  await requireAdminPage(`/admin/review/${jobId}`);
  const job = await getReviewJob(jobId);
  if (!job) notFound();
  return <Review key={job.jobId} job={job} />;
}
