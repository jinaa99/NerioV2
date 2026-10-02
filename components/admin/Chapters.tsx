'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Segmented } from '@/components/ui';
import { ADMIN_CH_TITLES, ADMIN_SERIES, CH_TONE, adminSeries, type ChapterStatus } from '@/lib/admin-data';
import { useAdmin } from './store';

const FILTERS: [number, string, ChapterStatus | null][] = [[0, 'All', null], [1, 'Published', 'PUBLISHED'], [2, 'In review', 'IN REVIEW'], [3, 'Processing', 'PROCESSING'], [4, 'Failed', 'FAILED']];
const ACTION: Record<ChapterStatus, string> = { PROCESSING: 'View job', 'IN REVIEW': 'Review', READY: 'Publish', PUBLISHED: 'Edit', FAILED: 'Retry' };

export default function Chapters() {
  const { toast } = useAdmin();
  const router = useRouter();
  const path = usePathname();
  const sid = useSearchParams().get('series') ?? 'lantern';
  const s = adminSeries(sid);
  const [filter, setFilter] = useState(0);

  const top = s.ch + 1;
  const rows = Array.from({ length: 10 }, (_, i) => top - i).filter(n => n > 0).map((n, i) => {
    const status: ChapterStatus = s.id === 'lantern'
      ? (i === 0 ? 'PROCESSING' : i === 1 ? 'IN REVIEW' : i === 2 ? 'READY' : 'PUBLISHED')
      : i === 0 ? (s.id === 'monster' ? 'FAILED' : 'PROCESSING') : 'PUBLISHED';
    const conf = status === 'PROCESSING' || status === 'FAILED' ? null : 0.97 - (i === 1 ? .2 : (i % 4) * .015);
    return { n, i, status, conf, pages: 44 + (n * 7) % 20, access: status === 'PUBLISHED' ? (i < 5 && s.status === 'Ongoing' ? 'EARLY · 6D' : 'FREE') : '—' };
  }).filter(c => !FILTERS[filter][2] || c.status === FILTERS[filter][2]);

  const act = (status: ChapterStatus, n: number) => {
    if (status === 'IN REVIEW') router.push('/admin/review');
    else if (status === 'PROCESSING' || status === 'FAILED') router.push('/admin/processing');
    else if (status === 'READY') toast(`Chapter ${n} published`);
    else toast('Chapter editor opens in the next build', 'info', 'var(--info)');
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Series" className="a-select" value={s.id} onChange={e => router.replace(`${path}?series=${e.target.value}`)}>
          {ADMIN_SERIES.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
        <div style={{ overflowX: 'auto' }}><Segmented h={30} options={FILTERS.map(([i, l]) => [i, l] as [number, string])} value={filter} onChange={setFilter} /></div>
      </div>
      <div className="a-table-wrap">
        <table className="a-table" style={{ minWidth: 720 }}>
          <thead><tr><th>CH.</th><th>TITLE</th><th>STATUS</th><th style={{ textAlign: 'right' }}>PAGES</th><th style={{ textAlign: 'right' }}>CONF.</th><th>ACCESS</th><th /></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.n}>
                <td style={{ fontFamily: 'var(--mono)', paddingTop: 12, paddingBottom: 12 }}>{c.n}</td>
                <td style={{ fontWeight: 600 }}>{ADMIN_CH_TITLES[c.i]}</td>
                <td><span className={`badge xs ${CH_TONE[c.status]}`}>{c.status}</span></td>
                <td className="num">{c.pages}</td>
                <td className="num" style={{ color: c.conf !== null && c.conf < .8 ? 'var(--warning-text)' : undefined }}>{c.conf === null ? '—' : c.conf.toFixed(2)}</td>
                <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-2)' }}>{c.access}</td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="btn btn-outline" style={{ '--h': '30px', '--px': '10px', '--r': '7px', '--fs': '12px', borderColor: 'rgba(255,255,255,.1)' } as React.CSSProperties} onClick={() => act(c.status, c.n)}>{ACTION[c.status]}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>No chapters with this status.</div>}
      </div>
    </div>
  );
}
