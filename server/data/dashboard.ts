import 'server-only';
import { sql } from 'drizzle-orm';
import { requireRole } from '../auth/actor';
import { db } from '../db/client';
import { imageSrc } from '../storage';

export type DashboardDTO = {
  series: { total: number; drafts: number; newThisMonth: number };
  chapters: { total: number; live: number; newThisMonth: number };
  users: { total: number; newThisWeek: number; active24h: number; premium: number };
  jobs: { queued: number; running: number; failed: number; byStage: Record<string, number>; latestFailure: string | null };
  reviews: { chapters: number; pendingRegions: number; minConfidence: number | null };
  payments: { pending: number; oldest: Date | null };
  reports: { open: number; byKind: Record<string, number> };
  /** Chapter opens per day (UTC), oldest first, last 90 days. */
  reads: { day: string; n: number }[];
  topSeries: { slug: string; title: string; coverHue: number; coverUrl: string | null; reads: number; previous: number }[];
};

type Row = Record<string, unknown>;

/** Operational overview. Every figure is a bounded aggregate served by existing indexes; one round trip per block. */
export async function getDashboard(): Promise<DashboardDTO> {
  await requireRole('editor');
  const run = <T extends Row>(q: ReturnType<typeof sql>) => db().execute<T>(q);
  const [[counts], stages, reads, top] = await Promise.all([
    run<Row>(sql`
      select
        (select count(*)::int from series where deleted_at is null) as series_total,
        (select count(*)::int from series where deleted_at is null and status = 'draft') as series_drafts,
        (select count(*)::int from series where deleted_at is null and created_at > now() - interval '30 days') as series_new,
        (select count(*)::int from chapters c join series s on s.id = c.series_id where s.deleted_at is null) as chapters_total,
        (select count(*)::int from chapters c join series s on s.id = c.series_id where s.deleted_at is null and c.status = 'published' and c.published_at <= now()) as chapters_live,
        (select count(*)::int from chapters where created_at > now() - interval '30 days') as chapters_new,
        (select count(*)::int from users where deleted_at is null) as users_total,
        (select count(*)::int from users where deleted_at is null and created_at > now() - interval '7 days') as users_new,
        (select count(distinct user_id)::int from reading_history where last_read_at > now() - interval '24 hours') as users_active,
        (select count(*)::int from profiles where premium_until > now()) as users_premium,
        (select count(*)::int from translation_jobs where status = 'queued') as jobs_queued,
        (select count(*)::int from translation_jobs where status = 'running') as jobs_running,
        (select count(*)::int from translation_jobs where status = 'failed') as jobs_failed,
        (select coalesce(error_code, 'ERROR') || coalesce(' · ' || left(error_message, 80), '') from translation_jobs where status = 'failed' order by updated_at desc limit 1) as latest_failure,
        (select count(*)::int from chapters where status = 'in_review') as review_chapters,
        (select count(*)::int from translation_segments s join translation_jobs j on j.id = s.job_id join chapters c on c.id = j.chapter_id
           where c.status = 'in_review' and j.status = 'ready' and s.review_status in ('pending', 'flagged')) as review_regions,
        (select min(s.confidence)::float8 from translation_segments s join translation_jobs j on j.id = s.job_id join chapters c on c.id = j.chapter_id
           where c.status = 'in_review' and j.status = 'ready' and s.review_status in ('pending', 'flagged')) as review_min_conf,
        (select count(*)::int from payment_records where status = 'pending') as payments_pending,
        (select min(created_at) from payment_records where status = 'pending') as payments_oldest,
        (select count(*)::int from content_reports where status = 'open') as reports_open,
        (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*)::int n from content_reports where status = 'open' group by kind) k) as reports_by_kind
    `),
    run<{ stage: string; n: number }>(sql`select stage::text, count(*)::int n from translation_jobs where status in ('queued', 'running', 'failed') group by stage`),
    run<{ day: string; n: number }>(sql`
      select to_char(d, 'YYYY-MM-DD') as day, coalesce(h.n, 0)::int as n
      from generate_series(date_trunc('day', now() at time zone 'utc') - interval '89 days', date_trunc('day', now() at time zone 'utc'), interval '1 day') d
      left join (select date_trunc('day', first_read_at at time zone 'utc') as day, count(*) n from reading_history where first_read_at > now() - interval '91 days' group by 1) h on h.day = d
      order by d`),
    run<{ slug: string; title: string; cover_hue: number; cover_key: string | null; reads: number; previous: number }>(sql`
      select s.slug, s.title, s.cover_hue, s.cover_key,
        count(*) filter (where h.last_read_at > now() - interval '7 days')::int as reads,
        count(*) filter (where h.last_read_at <= now() - interval '7 days')::int as previous
      from reading_history h join series s on s.id = h.series_id
      where h.last_read_at > now() - interval '14 days' and s.deleted_at is null
      group by s.id
      having count(*) filter (where h.last_read_at > now() - interval '7 days') > 0
      order by reads desc limit 5`),
  ]);
  const c = counts as Record<string, number | string | null | Record<string, number>>;
  const num = (k: string) => Number(c[k] ?? 0);
  return {
    series: { total: num('series_total'), drafts: num('series_drafts'), newThisMonth: num('series_new') },
    chapters: { total: num('chapters_total'), live: num('chapters_live'), newThisMonth: num('chapters_new') },
    users: { total: num('users_total'), newThisWeek: num('users_new'), active24h: num('users_active'), premium: num('users_premium') },
    jobs: {
      queued: num('jobs_queued'), running: num('jobs_running'), failed: num('jobs_failed'),
      byStage: Object.fromEntries(stages.map(s => [s.stage, s.n])), latestFailure: (c.latest_failure as string | null) ?? null,
    },
    reviews: { chapters: num('review_chapters'), pendingRegions: num('review_regions'), minConfidence: c.review_min_conf === null ? null : Number(c.review_min_conf) },
    payments: { pending: num('payments_pending'), oldest: c.payments_oldest ? new Date(c.payments_oldest as string) : null },
    reports: { open: num('reports_open'), byKind: (c.reports_by_kind as Record<string, number>) ?? {} },
    reads: reads.map(r => ({ day: r.day, n: Number(r.n) })),
    topSeries: top.map(t => ({ slug: t.slug, title: t.title, coverHue: Number(t.cover_hue), coverUrl: imageSrc(t.cover_key), reads: Number(t.reads), previous: Number(t.previous) })),
  };
}

/** Badge counts for the admin navigation. Cheap: partial/status indexes only. */
export async function getAdminNavCounts() {
  await requireRole('editor');
  const [row] = await db().execute<{ review: number; failed: number; active: number; payments: number; reports: number }>(sql`
    select
      (select count(*)::int from chapters where status = 'in_review') as review,
      (select count(*)::int from translation_jobs where status = 'failed') as failed,
      (select count(*)::int from translation_jobs where status in ('queued', 'running')) as active,
      (select count(*)::int from payment_records where status = 'pending') as payments,
      (select count(*)::int from content_reports where status = 'open') as reports
  `);
  return { review: Number(row.review), failed: Number(row.failed), active: Number(row.active), payments: Number(row.payments), reports: Number(row.reports) };
}
