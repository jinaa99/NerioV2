import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Workspace from '@/components/admin/translate/Workspace';
import { param } from '@/components/Pager';
import { requireAdminPage } from '@/server/auth/guards';
import { getWorkspace } from '@/server/data/manual-translation';

export const metadata: Metadata = { title: 'Translation workspace' };

export default async function Page({ params, searchParams }: PageProps<'/admin/translate/[chapterId]'>) {
  const { chapterId } = await params;
  await requireAdminPage(`/admin/translate/${chapterId}`);
  const [data, sp] = await Promise.all([getWorkspace(chapterId), searchParams]);
  if (!data) notFound();
  const mode = param(sp.mode);
  return <Workspace key={data.chapter.id} data={data} initialMode={mode === 'ocr' || mode === 'publish' ? mode : data.chapter.status === 'ready' || data.chapter.status === 'published' ? 'publish' : 'translate'} />;
}
