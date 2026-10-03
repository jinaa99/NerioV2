import type { MetadataRoute } from 'next';
import { and, asc, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { chapters, series } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

const origin = () => new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = origin();
  const now = new Date();
  const seriesRows = await db().select({ slug: series.slug, updatedAt: series.updatedAt }).from(series)
    .where(and(ne(series.status, 'draft'), isNull(series.deletedAt)))
    .orderBy(asc(series.slug)).limit(49_000);
  const chapterRows = await db().select({ slug: series.slug, number: chapters.number, publishedAt: chapters.publishedAt })
    .from(chapters).innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(ne(series.status, 'draft'), isNull(series.deletedAt), eq(chapters.status, 'published'), lte(chapters.publishedAt, sql`now()`),
      or(eq(chapters.access, 'free'), lte(chapters.freeAt, now))))
    .orderBy(sql`${chapters.publishedAt} desc`).limit(Math.max(0, 49_998 - seriesRows.length));

  return [
    { url: new URL('/', base).toString(), changeFrequency: 'daily' as const, priority: 1 },
    { url: new URL('/browse', base).toString(), changeFrequency: 'daily' as const, priority: 0.8 },
    ...seriesRows.map(row => ({ url: new URL(`/series/${row.slug}`, base).toString(), lastModified: row.updatedAt, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...chapterRows.map(row => ({ url: new URL(`/read/${row.slug}/${row.number}`, base).toString(), lastModified: row.publishedAt ?? now, changeFrequency: 'monthly' as const, priority: 0.5 })),
  ].slice(0, 50_000);
}
