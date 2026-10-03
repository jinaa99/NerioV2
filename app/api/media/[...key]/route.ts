import { eq, or } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { chapterPages, chapters, series } from '@/server/db/schema';
import { getImage } from '@/server/storage';
import { getCurrentActor, hasRole } from '@/server/auth/actor';

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  if (key.length !== 3) return new Response(null, { status: 404 });
  const objectKey = key.join('/');
  const [page] = await db().select({ status: chapters.status, publishedAt: chapters.publishedAt, deletedAt: series.deletedAt })
    .from(chapterPages).innerJoin(chapters, eq(chapters.id, chapterPages.chapterId)).innerJoin(series, eq(series.id, chapters.seriesId))
    .where(or(eq(chapterPages.sourceKey, objectKey), eq(chapterPages.outputKey, objectKey)));
  if (!page || page.deletedAt) return new Response(null, { status: 404 });
  const actor = await getCurrentActor();
  const staff = hasRole(actor, 'editor');
  if (!(staff || (hasRole(actor, 'translator') && page.status === 'in_review') || (page.status === 'published' && page.publishedAt && page.publishedAt <= new Date()))) return new Response(null, { status: 404 });
  const body = await getImage(objectKey);
  if (!body) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
