'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon, Segmented } from '@/components/ui';
import { compact, coverBg, timeAgo } from '@/lib/catalog';
import type { DashboardDTO } from '@/server/data/dashboard';
import { PIPELINE_STAGE_LABEL, PIPELINE_STAGE_ORDER } from './pipeline-ui';

const RANGES = [7, 30, 90] as const;
const REPORT_KIND_LABEL: Record<string, string> = { wrong_translation: 'translation', missing_page: 'missing page', text_overflow: 'text overflow', image_quality: 'image quality', other: 'other' };
const fmt = (n: number) => n.toLocaleString('en-US');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();

export default function Overview({ d }: { d: DashboardDTO }) {
  const router = useRouter();
  const [range, setRange] = useState(1);
  const days = RANGES[range];
  const reads = d.reads.slice(-days);
  const readsTotal = reads.reduce((a, r) => a + r.n, 0);
  const peak = Math.max(1, ...reads.map(r => r.n));
  const active = d.jobs.queued + d.jobs.running;

  const metrics: { label: string; icon: string; value: string; sub: string; href: string; tone?: 'danger' | 'muted' | 'good' | 'warn' }[] = [
    { label: 'Total users', icon: 'group', value: fmt(d.users.total), sub: d.users.newThisWeek ? `↑ ${fmt(d.users.newThisWeek)} this week` : 'No sign-ups this week', href: '/admin/users', tone: d.users.newThisWeek ? 'good' : 'muted' },
    { label: 'Active readers · 24h', icon: 'bolt', value: fmt(d.users.active24h), sub: `${fmt(d.users.premium)} Premium`, href: '/admin/users', tone: 'muted' },
    { label: 'Total series', icon: 'collections_bookmark', value: fmt(d.series.total), sub: d.series.drafts ? `${fmt(d.series.drafts)} drafts` : d.series.newThisMonth ? `↑ ${d.series.newThisMonth} this month` : 'All published', href: '/admin/series', tone: 'muted' },
    { label: 'Total chapters', icon: 'auto_stories', value: fmt(d.chapters.total), sub: `${fmt(d.chapters.live)} live${d.chapters.newThisMonth ? ` · ↑ ${fmt(d.chapters.newThisMonth)} this month` : ''}`, href: '/admin/chapters', tone: 'muted' },
    { label: 'Processing jobs', icon: 'memory', value: fmt(active), sub: active ? `${d.jobs.queued} queued · ${d.jobs.running} running` : 'Nothing in the pipeline', href: '/admin/processing', tone: 'muted' },
    { label: 'Failed jobs', icon: 'error', value: fmt(d.jobs.failed), sub: d.jobs.failed ? 'Needs retry' : 'All clear', href: '/admin/processing?filter=failed', tone: d.jobs.failed ? 'danger' : 'good' },
    { label: 'Pending reviews', icon: 'rate_review', value: fmt(d.reviews.chapters), sub: d.reviews.chapters ? `${fmt(d.reviews.pendingRegions)} regions to check` : 'Queue is empty', href: '/admin/queue', tone: d.reviews.chapters ? 'warn' : 'good' },
  ];
  const subColor = { danger: 'var(--ink-2)', muted: 'var(--ink-3)', good: 'var(--success-text)', warn: 'var(--warning-text)' } as const;

  const reportKinds = Object.entries(d.reports.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${REPORT_KIND_LABEL[k] ?? k}`).join(', ');
  const attention: [string, string, string, string, string][] = [
    ...(d.jobs.failed ? [['error', 'var(--danger)', `${d.jobs.failed} failed job${d.jobs.failed === 1 ? '' : 's'}`, d.jobs.latestFailure ?? 'See processing for details', '/admin/processing?filter=failed'] as [string, string, string, string, string]] : []),
    ...(d.reviews.chapters ? [['translate', 'var(--warning)', `${d.reviews.chapters} chapter${d.reviews.chapters === 1 ? '' : 's'} awaiting review`, d.reviews.minConfidence !== null ? `Lowest confidence ${d.reviews.minConfidence.toFixed(2)}` : `${d.reviews.pendingRegions} regions to check`, '/admin/queue'] as [string, string, string, string, string]] : []),
    ...(d.payments.pending ? [['payments', 'var(--ember)', `${d.payments.pending} transfer${d.payments.pending === 1 ? '' : 's'} to confirm`, d.payments.oldest ? `Oldest submitted ${timeAgo(d.payments.oldest)}` : '', '/admin/users?tab=payments'] as [string, string, string, string, string]] : []),
    ...(d.reports.open ? [['flag', 'var(--info)', `${d.reports.open} open reader report${d.reports.open === 1 ? '' : 's'}`, reportKinds, '/admin/reports'] as [string, string, string, string, string]] : []),
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,190px),1fr))', gap: 12 }}>
        {metrics.map(m => {
          const alert = m.tone === 'danger';
          return (
            <Link key={m.label} href={m.href} className="metric" style={{ borderColor: alert ? 'rgba(229,103,92,.3)' : undefined }}>
              <span className="row" style={{ justifyContent: 'space-between', font: '500 12px var(--sans)', color: 'var(--ink-3)' }}>{m.label}<Icon name={m.icon} size={17} /></span>
              <span style={{ font: '500 28px/1 var(--mono)', letterSpacing: '-.03em', color: alert ? 'var(--danger-text)' : 'var(--ink-1)' }}>{m.value}</span>
              <span style={{ font: '500 12px var(--mono)', color: subColor[m.tone ?? 'muted'] }} suppressHydrationWarning>{m.sub}</span>
            </Link>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,460px),1fr))', gap: 16 }}>
        <section className="a-section">
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 2 }}><span style={{ font: '600 15px var(--sans)' }}>Chapter reads</span><span className="meta">LAST {days} DAYS · {compact(readsTotal)}</span></div>
            <Segmented h={28} options={[[0, '7d'], [1, '30d'], [2, '90d']]} value={range} onChange={setRange} />
          </div>
          <div className="row" style={{ height: 180, alignItems: 'flex-end', gap: days > 30 ? 1 : 3 }} role="img" aria-label={`Chapter reads per day, last ${days} days, ${readsTotal} total`}>
            {reads.map((r, i) => (
              <div key={r.day} title={`${day(r.day)} · ${fmt(r.n)} reads`} className="read-bar"
                style={{ flex: 1, height: `${Math.max(2, (r.n / peak) * 100)}%`, borderRadius: '3px 3px 0 0', background: i === reads.length - 1 ? 'var(--ember)' : 'var(--s4)', transition: 'height .4s var(--ease)' }} />
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', font: '400 11px var(--mono)', color: 'var(--ink-4)' }}>
            <span>{day(reads[0].day)}</span><span>{day(reads[Math.floor(reads.length / 2)].day)}</span><span>{day(reads[reads.length - 1].day)}</span>
          </div>
        </section>
        <section className="a-section" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ font: '600 15px var(--sans)' }}>Pipeline right now</span>
            <Link href="/admin/processing" style={{ color: 'var(--ink-2)', font: '500 13px var(--sans)' }}>Open processing →</Link>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {PIPELINE_STAGE_ORDER.map(stage => {
              const n = d.jobs.byStage[stage] ?? 0;
              const max = Math.max(1, ...Object.values(d.jobs.byStage));
              return (
                <div key={stage} style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr) 28px', alignItems: 'center', gap: 12 }}>
                  <span style={{ font: '500 11px var(--mono)', color: 'var(--ink-2)' }}>{PIPELINE_STAGE_LABEL[stage]}</span>
                  <div style={{ height: 6, borderRadius: 3, background: '#1A1A1E' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', borderRadius: 3, background: stage === 'ready' ? 'var(--info)' : 'var(--ember)' }} /></div>
                  <span style={{ font: '500 12px var(--mono)', textAlign: 'right', color: n ? 'var(--ink-1)' : 'var(--ink-4)' }}>{n}</span>
                </div>
              );
            })}
          </div>
          {active + d.jobs.failed === 0 && <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No jobs are queued. Upload a chapter with processing on to start one.</span>}
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,460px),1fr))', gap: 16 }}>
        <section className="a-card" style={{ overflow: 'hidden' }}>
          <div className="a-section-head"><span style={{ font: '600 15px var(--sans)' }}>Needs attention</span><span style={{ font: '500 11px var(--mono)', color: 'var(--ink-3)' }}>{attention.length} ITEMS</span></div>
          {attention.length === 0 && (
            <div className="row" style={{ gap: 12, padding: '18px 20px', color: 'var(--ink-3)', fontSize: 14 }}><Icon name="check_circle" color="var(--success)" />Nothing needs attention right now.</div>
          )}
          {attention.map(([icon, color, title, sub, href]) => (
            <button key={title} type="button" className="row-btn" style={{ gap: 12, padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,.05)', borderRadius: 0 }} onClick={() => router.push(href)}>
              <Icon name={icon} color={color} />
              <div className="stack grow" style={{ gap: 2, minWidth: 0 }}><span style={{ font: '600 14px var(--sans)' }}>{title}</span><span className="ellipsis" style={{ fontSize: 13, color: 'var(--ink-3)' }} suppressHydrationWarning>{sub}</span></div>
              <Icon name="chevron_right" color="var(--ink-4)" />
            </button>
          ))}
        </section>
        <section className="a-card" style={{ overflow: 'hidden' }}>
          <div className="a-section-head"><span style={{ font: '600 15px var(--sans)' }}>Top series · 7 days</span><span style={{ font: '500 11px var(--mono)', color: 'var(--ink-3)' }}>CHAPTER READS</span></div>
          {d.topSeries.length === 0 && <div style={{ padding: '18px 20px', color: 'var(--ink-3)', fontSize: 14 }}>No reads in the last 7 days.</div>}
          {d.topSeries.map((s, i) => {
            const delta = s.previous ? Math.round(((s.reads - s.previous) / s.previous) * 100) : null;
            return (
              <Link key={s.slug} href={`/series/${s.slug}`} target="_blank" className="row" style={{ gap: 12, padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,.05)', color: 'var(--ink-1)' }}>
                <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-4)', width: 16 }}>{i + 1}</span>
                <div style={{ width: 28, aspectRatio: '3/4', borderRadius: 5, background: coverBg(s.coverHue, s.coverUrl) }} />
                <span className="grow ellipsis" style={{ font: '500 14px var(--sans)' }}>{s.title}</span>
                <span style={{ font: '500 13px var(--mono)' }}>{compact(s.reads)}</span>
                <span style={{ font: '500 12px var(--mono)', width: 56, textAlign: 'right', color: delta === null ? 'var(--ink-4)' : delta < 0 ? 'var(--danger-text)' : 'var(--success-text)' }}>
                  {delta === null ? 'NEW' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%`}
                </span>
              </Link>
            );
          })}
        </section>
      </div>
    </>
  );
}
