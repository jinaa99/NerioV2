'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui';
import { QUEUE, adminSeries, confColors } from '@/lib/admin-data';
import { cover } from '@/lib/data';

export default function Queue() {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>Chapters wait here when any region scores below the 0.80 auto-publish threshold.</span>
      {QUEUE.map(([id, ch, pages, regions, age, conf, warns]) => {
        const s = adminSeries(id);
        const [c] = confColors(conf);
        return (
          <div key={id} className="a-card row" style={{ gap: 16, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 14 }}>
            <div style={{ width: 40, aspectRatio: '3/4', borderRadius: 6, background: cover(s.hue), flex: 'none' }} />
            <div className="stack" style={{ flex: '1 1 200px', minWidth: 0, gap: 3 }}>
              <span style={{ font: '600 15px var(--sans)' }}>{s.title} · Ch. {ch}</span>
              <span className="meta">{pages} PAGES · {regions} REGIONS · WAITING {age}</span>
            </div>
            <div className="stack" style={{ gap: 5, width: 140 }}>
              <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>AVG CONFIDENCE {conf.toFixed(2)}</span>
              <div style={{ height: 5, borderRadius: 3, background: 'var(--s4)' }}><div style={{ width: `${conf * 100}%`, height: '100%', borderRadius: 3, background: c }} /></div>
            </div>
            <span className={`badge xs ${warns ? 'warning' : 'neutral'}`} style={{ padding: '4px 8px', borderRadius: 6 }}><Icon name="warning" size={13} />{warns} WARNINGS</span>
            <Link href="/admin/review" className="btn btn-primary" style={{ '--h': '36px', '--px': '14px', '--r': '9px', '--fs': '13px', color: 'var(--bg)' } as React.CSSProperties}>Review</Link>
          </div>
        );
      })}
    </div>
  );
}
