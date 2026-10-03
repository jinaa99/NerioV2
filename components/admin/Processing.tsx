'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Pager from '@/components/Pager';
import { Button, Icon, Segmented } from '@/components/ui';
import { chapterNo, coverBg, timeAgo } from '@/lib/catalog';
import { cancelJobAction, retryJobAction } from '@/server/actions/admin';
import type { JobDTO, JobFilter } from '@/server/data/pipeline';
import { JOB_TONE, PIPELINE_STAGE_LABEL, PIPELINE_STAGE_ORDER, PIPELINE_STAGE_SHORT } from './pipeline-ui';
import { useAdmin } from './store';

type Counts = { queued: number; running: number; failed: number; ready: number; cancelled: number };
const FILTERS: [JobFilter, string][] = [['active', 'Active'], ['failed', 'Failed'], ['ready', 'Ready'], ['cancelled', 'Cancelled'], ['all', 'All']];

export default function Processing({ data, filter, counts, paused }: { data: { items: JobDTO[]; total: number; limit: number; offset: number }; filter: JobFilter; counts: Counts; paused: boolean }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const path = usePathname();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const act = (j: JobDTO, kind: 'retry' | 'cancel') => {
    setBusy(j.id);
    startTransition(async () => {
      const res = await (kind === 'retry' ? retryJobAction(j.id) : cancelJobAction(j.id));
      setBusy(null);
      if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
      toast(kind === 'retry' ? `${j.series.title} · Ch. ${chapterNo(j.chapter.number)} queued again` : 'Job cancelled', kind === 'retry' ? 'refresh' : 'block', 'var(--info)');
      router.refresh();
    });
  };

  const tiles: [string, number, string][] = [['QUEUED', counts.queued, 'var(--ink-3)'], ['RUNNING', counts.running, 'var(--ember)'], ['FAILED', counts.failed, 'var(--danger)'], ['READY', counts.ready, 'var(--info)']];

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,180px),1fr))', gap: 10 }}>
        {tiles.map(([name, n, dot]) => (
          <div key={name} className="a-card stack" style={{ padding: '12px 14px', borderRadius: 12, gap: 6 }}>
            <span className="row" style={{ gap: 8, font: '500 12px var(--mono)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: n ? dot : 'var(--ink-5)' }} />{name}</span>
            <span style={{ font: '500 22px var(--mono)' }}>{n}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 10, padding: '10px 14px', borderRadius: 12, border: '1px solid var(--line-1)', fontSize: 13, color: 'var(--ink-3)' }}>
        <Icon name="info" size={18} />
        {paused ? 'The pipeline is paused in Settings. Queued jobs wait until it is resumed.' : 'Queued jobs are picked up by processing workers. Automated OCR and translation workers aren’t connected yet, so jobs stay queued until they are.'}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ overflowX: 'auto' }}>
          <Segmented h={30} options={FILTERS} value={filter} onChange={v => startTransition(() => router.replace(v === 'all' ? path : `${path}?filter=${v}`))} />
        </div>
        <span className="meta" style={{ marginLeft: 'auto' }}>{data.total} JOB{data.total === 1 ? '' : 'S'}</span>
      </div>

      {data.items.length === 0 && (
        <div className="a-card stack" style={{ padding: 40, alignItems: 'center', gap: 8, color: 'var(--ink-3)', textAlign: 'center' }}>
          <Icon name="memory" size={28} />
          <span>{filter === 'failed' ? 'No failed jobs.' : filter === 'active' ? 'Nothing is being processed.' : 'No jobs here.'}</span>
          <Link href="/admin/upload" style={{ color: 'var(--ember-text)', font: '500 13px var(--sans)' }}>Upload a chapter →</Link>
        </div>
      )}

      <div className="stack" style={{ gap: 12, opacity: pending && !busy ? .6 : 1, transition: 'opacity .2s' }}>
        {data.items.map(j => {
          const isFailed = j.status === 'failed';
          const stageIdx = PIPELINE_STAGE_ORDER.indexOf(j.stage);
          const label = j.status === 'running' ? `${PIPELINE_STAGE_LABEL[j.stage]} · ${j.stageProgress}%` : j.status === 'queued' ? `QUEUED · ${PIPELINE_STAGE_LABEL[j.stage]}` : j.status.toUpperCase();
          return (
            <div key={j.id} className="a-card stack" style={{ padding: 16, borderRadius: 14, gap: 14, borderColor: isFailed ? 'rgba(229,103,92,.25)' : undefined }}>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div style={{ width: 32, aspectRatio: '3/4', borderRadius: 5, background: coverBg(j.series.coverHue, j.series.coverUrl), flex: 'none' }} />
                <div className="stack" style={{ flex: '1 1 200px', gap: 2, minWidth: 0 }}>
                  <Link href={`/admin/chapters/${j.chapter.id}`} className="ellipsis" style={{ font: '600 14px var(--sans)', color: 'var(--ink-1)' }}>{j.series.title} · Ch. {chapterNo(j.chapter.number)}</Link>
                  <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }} suppressHydrationWarning>
                    JOB-{j.id.slice(0, 8).toUpperCase()} · {j.sourceLanguage.toUpperCase()} → {j.targetLanguage.toUpperCase()} · {j.chapter.pageCount} PAGES · ATTEMPT {j.attempt} · {j.startedAt ? `STARTED ${timeAgo(j.startedAt).toUpperCase()}` : `CREATED ${timeAgo(j.createdAt).toUpperCase()}`}
                  </span>
                </div>
                <span className={`badge xs ${JOB_TONE[j.status]}`} style={{ padding: '4px 8px', borderRadius: 6 }}>{label}</span>
                {(isFailed || j.status === 'cancelled') && <Button variant="secondary" h={32} px={12} icon="refresh" loading={busy === j.id} onClick={() => act(j, 'retry')}>Retry</Button>}
                {(j.status === 'running' || j.status === 'queued') && <Button variant="ghost" h={32} loading={busy === j.id} onClick={() => { if (confirm('Cancel this job? The chapter returns to draft.')) act(j, 'cancel'); }}>Cancel</Button>}
                {j.status === 'ready' && j.chapter.status === 'in_review' && <Link href={`/admin/review/${j.id}`} className="btn btn-secondary" style={{ '--h': '32px', '--px': '12px', '--fs': '13px' } as React.CSSProperties}>Review</Link>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,minmax(0,1fr))', gap: 4 }}>
                {PIPELINE_STAGE_ORDER.map((name, i) => {
                  const cur = i === stageIdx;
                  const done = i < stageIdx || (j.status === 'ready' && i <= stageIdx && name !== 'ready');
                  const bg = done ? 'var(--success)' : cur ? (isFailed ? 'var(--danger)' : j.status === 'ready' ? 'var(--info)' : j.status === 'running' ? `linear-gradient(90deg,#E8825F ${j.stageProgress}%,#2A2A30 ${j.stageProgress}%)` : 'var(--s4)') : 'var(--s4)';
                  const color = done ? 'var(--success-text)' : cur ? (isFailed ? 'var(--danger-text)' : 'var(--ember-text)') : 'var(--ink-4)';
                  return (
                    <div key={name} title={PIPELINE_STAGE_LABEL[name]} className="stack" style={{ gap: 6, minWidth: 0 }}>
                      <div style={{ height: 4, borderRadius: 2, background: bg, outline: cur && j.status === 'queued' ? '1px dashed var(--ink-4)' : undefined }} />
                      <span className="ellipsis" style={{ font: '500 9px var(--mono)', color }}>{PIPELINE_STAGE_SHORT[name]}</span>
                    </div>
                  );
                })}
              </div>
              {isFailed && (j.errorCode || j.errorMessage) && (
                <div style={{ font: '400 12px var(--mono)', color: 'var(--danger-text)', padding: '8px 10px', borderRadius: 8, background: 'rgba(229,103,92,.06)' }}>
                  {[j.errorCode, j.errorMessage].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pager total={data.total} limit={data.limit} offset={data.offset} path={path} params={{ filter: filter === 'all' ? undefined : filter }} />
    </div>
  );
}
