'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import Pager from '@/components/Pager';
import { Icon, Segmented } from '@/components/ui';
import { SERIES_STATUS_LABEL, SERIES_STATUS_TONE, compact, coverBg, timeAgo, type SeriesStatus } from '@/lib/catalog';
import type { AdminSeriesRowDTO, Paged } from '@/server/data/catalog';

const TABS: [string, string][] = [['', 'All'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus'], ['draft', 'Draft']];
const smallBtn = { '--h': '30px', '--px': '10px', '--r': '7px', '--fs': '12px', borderColor: 'rgba(255,255,255,.1)' } as React.CSSProperties;

export default function SeriesTable({ data, q, status }: { data: Paged<AdminSeriesRowDTO>; q: string; status: SeriesStatus | '' }) {
  const router = useRouter();
  const path = usePathname();
  const [query, setQuery] = useState(q);
  const [pending, startTransition] = useTransition();

  const go = (next: { q?: string; status?: string }) => {
    const sp = new URLSearchParams();
    const nq = next.q ?? query, ns = next.status ?? status;
    if (nq.trim()) sp.set('q', nq.trim());
    if (ns) sp.set('status', ns);
    startTransition(() => router.replace(sp.size ? `${path}?${sp}` : path));
  };

  // Debounced server-side filter.
  useEffect(() => {
    if (query === q) return;
    const t = setTimeout(() => go({ q: query }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed query should trigger this
  }, [query]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="searchbox" style={{ flex: '1 1 240px', maxWidth: 360, '--h': '36px', borderRadius: 9, padding: '0 10px' } as React.CSSProperties}>
          <Icon name="search" size={18} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by title, author or slug" aria-label="Filter series" style={{ fontSize: 13 }} />
          {pending && <span className="spinner" />}
        </label>
        <div style={{ overflowX: 'auto' }}>
          <Segmented h={30} options={TABS} value={status} onChange={v => go({ status: v })} />
        </div>
        <div className="grow" />
        <Link href="/admin/series/new" className="btn btn-secondary" style={{ '--h': '36px', '--fs': '13px', gap: 6 } as React.CSSProperties}><Icon name="add" size={18} />New series</Link>
      </div>
      <div className="a-table-wrap" style={{ opacity: pending ? .6 : 1, transition: 'opacity .2s' }}>
        <table className="a-table" style={{ minWidth: 820 }}>
          <thead><tr><th>SERIES</th><th>STATUS</th><th>GENRES</th><th style={{ textAlign: 'right' }}>CHAPTERS</th><th style={{ textAlign: 'right' }}>READS</th><th>UPDATED</th><th /></tr></thead>
          <tbody>
            {data.items.map(s => (
              <tr key={s.id}>
                <td><Link href={`/admin/series/${s.id}`} className="row" style={{ gap: 12, color: 'var(--ink-1)' }}>
                  <div style={{ width: 32, aspectRatio: '3/4', borderRadius: 5, background: coverBg(s.coverHue, s.coverUrl), flex: 'none' }} />
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{s.title}</span>
                    <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{s.author} · /{s.slug}</span>
                  </div>
                </Link></td>
                <td><span className={`badge xs ${SERIES_STATUS_TONE[s.status]}`}>{SERIES_STATUS_LABEL[s.status].toUpperCase()}</span></td>
                <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{s.genres.slice(0, 3).join(', ') || '—'}</td>
                <td className="num" title={`${s.publishedCount} live of ${s.chapterCount}`}>{s.publishedCount}<span style={{ color: 'var(--ink-4)' }}> / {s.chapterCount}</span></td>
                <td className="num">{compact(s.viewCount)}</td>
                <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-3)' }} suppressHydrationWarning>{timeAgo(s.updatedAt)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Link href={`/admin/series/${s.id}`} className="btn btn-ghost" style={smallBtn}>Edit</Link>
                  <Link href={`/admin/chapters?series=${s.id}`} className="btn btn-outline" style={{ ...smallBtn, marginLeft: 6 }}>Chapters</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.items.length === 0 && (
          <div className="stack" style={{ padding: 40, alignItems: 'center', gap: 6, color: 'var(--ink-3)' }}>
            <Icon name={q ? 'search_off' : 'collections_bookmark'} size={26} />
            {q ? `No series match “${q}”.` : 'No series yet. Create the first one.'}
          </div>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span className="meta">{data.total} SERIES</span>
        <Pager total={data.total} limit={data.limit} offset={data.offset} path={path} params={{ q, status }} />
      </div>
    </div>
  );
}
