'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Pager from '@/components/Pager';
import { Icon } from '@/components/ui';
import { chapterNo, coverBg, timeAgo } from '@/lib/catalog';
import type { ReviewQueueItemDTO } from '@/server/data/pipeline';
import { confColors } from './pipeline-ui';

export default function Queue({ data, threshold }: { data: { items: ReviewQueueItemDTO[]; total: number; limit: number; offset: number }; threshold: number }) {
  const path = usePathname();
  return (
    <div className="stack" style={{ gap: 12 }}>
      <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>Chapters wait here when any region scores below the {threshold.toFixed(2)} auto-publish threshold, or when a series requires human QA.</span>
      {data.items.length === 0 && (
        <div className="a-card stack" style={{ padding: 40, alignItems: 'center', gap: 8, color: 'var(--ink-3)', textAlign: 'center' }}>
          <Icon name="task_alt" size={28} />
          <span style={{ font: '600 15px var(--sans)', color: 'var(--ink-1)' }}>Review queue is empty</span>
          <span style={{ fontSize: 13 }}>Chapters appear here when the pipeline finishes translating them.</span>
        </div>
      )}
      {data.items.map(r => {
        const conf = r.avgConfidence ?? 0;
        const [c] = confColors(conf);
        const open = r.pending + r.flagged;
        return (
          <div key={r.jobId} className="a-card row" style={{ gap: 16, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 14 }}>
            <div style={{ width: 40, aspectRatio: '3/4', borderRadius: 6, background: coverBg(r.series.coverHue, r.series.coverUrl), flex: 'none' }} />
            <div className="stack" style={{ flex: '1 1 200px', minWidth: 0, gap: 3 }}>
              <span className="ellipsis" style={{ font: '600 15px var(--sans)' }}>{r.series.title} · Ch. {chapterNo(r.chapterNumber)}</span>
              <span className="meta" suppressHydrationWarning>{r.pageCount} PAGES · {r.regions} REGIONS · {open} TO CHECK · WAITING {timeAgo(r.waitingSince).replace(' ago', '').toUpperCase()}</span>
            </div>
            <div className="stack" style={{ gap: 5, width: 140 }}>
              <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{r.avgConfidence === null ? 'NO CONFIDENCE DATA' : `AVG CONFIDENCE ${conf.toFixed(2)}`}</span>
              <div style={{ height: 5, borderRadius: 3, background: 'var(--s4)' }}><div style={{ width: `${conf * 100}%`, height: '100%', borderRadius: 3, background: c }} /></div>
            </div>
            <span className={`badge xs ${r.warnings ? 'warning' : 'neutral'}`} style={{ padding: '4px 8px', borderRadius: 6 }}><Icon name="warning" size={13} />{r.warnings} WARNINGS</span>
            <Link href={`/admin/review/${r.jobId}`} className="btn btn-primary" style={{ '--h': '36px', '--px': '14px', '--r': '9px', '--fs': '13px', color: 'var(--bg)' } as React.CSSProperties}>Review</Link>
          </div>
        );
      })}
      <Pager total={data.total} limit={data.limit} offset={data.offset} path={path} />
    </div>
  );
}
