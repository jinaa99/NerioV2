import { eq, or } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { chapterPages, chapters, series } from '@/server/db/schema';
import { getImage, isSeriesCoverKey } from '@/server/storage';
import { getCurrentActor, hasRole } from '@/server/auth/actor';

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  const objectKey = key.join('/');
  if (isSeriesCoverKey(objectKey)) {
    const [cover] = await db().select({ status: series.status, deletedAt: series.deletedAt }).from(series).where(eq(series.coverKey, objectKey));
    const actor = await getCurrentActor();
    if (cover?.deletedAt) return new Response(null, { status: 404 });
    if (!cover && !hasRole(actor, 'editor')) return new Response(null, { status: 404 });
    if (cover && !(hasRole(actor, 'editor') || cover.status !== 'draft')) return new Response(null, { status: 404 });
    const body = await getImage(objectKey);
    if (!body) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (key.length !== 3) return new Response(null, { status: 404 });
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
