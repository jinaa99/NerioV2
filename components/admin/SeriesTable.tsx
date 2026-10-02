'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Icon, Segmented } from '@/components/ui';
import { ADMIN_SERIES } from '@/lib/admin-data';
import { STATUS_TONE, cover } from '@/lib/data';
import { useAdmin } from './store';

const TABS = ['All', 'Ongoing', 'Completed', 'Draft'] as const;

export default function SeriesTable() {
  const { toast } = useAdmin();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState(0);
  const rows = ADMIN_SERIES.filter(s => (tab === 0 || s.status === TABS[tab]) && s.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="searchbox" style={{ flex: '1 1 240px', maxWidth: 360, '--h': '36px', borderRadius: 9, padding: '0 10px' } as React.CSSProperties}>
          <Icon name="search" size={18} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter series" aria-label="Filter series" style={{ fontSize: 13 }} />
        </label>
        <Segmented h={30} options={TABS.map((l, i) => [i, l] as [number, string])} value={tab} onChange={setTab} />
        <div className="grow" />
        <Button variant="secondary" h={36} fs={13} icon="add" onClick={() => toast('Series editor opens in the next build', 'info', 'var(--info)')}>New series</Button>
      </div>
      <div className="a-table-wrap">
        <table className="a-table" style={{ minWidth: 760 }}>
          <thead><tr><th>SERIES</th><th>STATUS</th><th style={{ textAlign: 'right' }}>CHAPTERS</th><th style={{ textAlign: 'right' }}>READS</th><th>LANGUAGES</th><th>UPDATED</th><th /></tr></thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id}>
                <td><div className="row" style={{ gap: 12 }}>
                  <div style={{ width: 32, aspectRatio: '3/4', borderRadius: 5, background: cover(s.hue), flex: 'none' }} />
                  <div className="stack" style={{ gap: 2 }}><span style={{ fontWeight: 600 }}>{s.title}</span><span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{s.author}</span></div>
                </div></td>
                <td><span className={`badge xs ${STATUS_TONE[s.status]}`}>{s.status.toUpperCase()}</span></td>
                <td className="num">{s.ch}</td>
                <td className="num">{s.reads}</td>
                <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-2)' }}>KO → EN</td>
                <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-3)' }}>{s.when}</td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/admin/chapters?series=${s.id}`} className="btn btn-outline" style={{ '--h': '30px', '--px': '10px', '--r': '7px', '--fs': '12px', borderColor: 'rgba(255,255,255,.1)' } as React.CSSProperties}>Chapters</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="stack" style={{ padding: 40, alignItems: 'center', gap: 6, color: 'var(--ink-3)' }}><Icon name="search_off" size={26} />No series match “{q}”.</div>
        )}
      </div>
    </div>
  );
}
