'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import Pager from '@/components/Pager';
import { Button, Cover, Icon, Segmented } from '@/components/ui';
import { SERIES_STATUS_LABEL, SERIES_STATUS_TONE, chapterNo, compact, coverBg } from '@/lib/catalog';
import type { Paged, SeriesCardDTO } from '@/server/data/catalog';
import { Footer } from './Chrome';
import { BookmarkFab } from './Home';

export type BrowseFilters = { q: string; genre: string; status: '' | 'ongoing' | 'completed' | 'hiatus'; sort: 'popular' | 'updated' | 'new' | 'rating' | 'title' };

const SORTS: [BrowseFilters['sort'], string][] = [['popular', 'Most read'], ['updated', 'Recently updated'], ['new', 'Newest'], ['rating', 'Top rated'], ['title', 'A–Z']];
const STATUSES: [BrowseFilters['status'], string][] = [['', 'Any'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus']];

export default function Browse({ data, filters, genres }: { data: Paged<SeriesCardDTO>; filters: BrowseFilters; genres: { slug: string; name: string; count: number }[] }) {
  const router = useRouter();
  const path = usePathname();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);

  const go = (patch: Partial<BrowseFilters>) => {
    const next = { ...filters, q: query, ...patch };
    const sp = new URLSearchParams();
    if (next.q.trim()) sp.set('q', next.q.trim());
    if (next.genre) sp.set('genre', next.genre);
    if (next.status) sp.set('status', next.status);
    if (next.sort !== 'popular') sp.set('sort', next.sort);
    startTransition(() => router.push(sp.size ? `${path}?${sp}` : path, { scroll: false }));
  };

  useEffect(() => {
    if (query === filters.q) return;
    const t = setTimeout(() => go({ q: query }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only typing should trigger this
  }, [query]);

  const genreName = genres.find(g => g.slug === filters.genre)?.name;
  const heading = genreName ?? (filters.q ? `Results for “${filters.q}”` : 'Browse');
  const filtered = !!(filters.q || filters.genre || filters.status);

  return (
    <div className="page-anim">
      <div className="container stack" style={{ paddingTop: 'clamp(20px,3vw,40px)', gap: 24 }}>
        <div className="stack" style={{ gap: 8 }}>
          <span className="kicker accent">{genreName ? 'Genre' : 'Catalog'}</span>
          <h1 style={{ font: '400 clamp(36px,5vw,60px)/1 var(--serif)', letterSpacing: '-.02em', textWrap: 'balance' }}>{heading}</h1>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label className="searchbox" style={{ flex: '1 1 280px', maxWidth: 520 }}>
              <Icon name="search" size={20} />
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go({ q: query }); }}
                placeholder="Title, author, alternative title or tag" aria-label="Search series" inputMode="search" />
              {query && <button type="button" className="icon-btn" style={{ '--h': '28px' } as React.CSSProperties} aria-label="Clear search" onClick={() => { setQuery(''); go({ q: '' }); }}><Icon name="close" size={18} /></button>}
            </label>
            <select aria-label="Sort" className="input" value={filters.sort} onChange={e => go({ sort: e.target.value as BrowseFilters['sort'] })} style={{ '--h': '44px', width: 'auto', minWidth: 170 } as React.CSSProperties}>
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div style={{ overflowX: 'auto' }}><Segmented h={44} label="Status" options={STATUSES} value={filters.status} onChange={v => go({ status: v })} /></div>
          </div>
          {genres.length > 0 && (
            <div className="row" style={{ gap: 6, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }} role="group" aria-label="Genre">
              <button type="button" aria-pressed={!filters.genre} className="genre-chip" onClick={() => go({ genre: '' })}>All genres</button>
              {genres.map(g => (
                <button key={g.slug} type="button" aria-pressed={filters.genre === g.slug} className="genre-chip" onClick={() => go({ genre: filters.genre === g.slug ? '' : g.slug })}>
                  {g.name} <span style={{ opacity: .55, font: '500 11px var(--mono)', marginLeft: 4 }}>{g.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <span className="meta">{data.total} SERIES{pending && ' · LOADING'}</span>
          {filtered && <Button variant="ghost" h={32} fs={13} icon="filter_alt_off" onClick={() => { setQuery(''); go({ q: '', genre: '', status: '' }); }}>Clear filters</Button>}
        </div>

        {data.items.length === 0 ? (
          <div className="empty" style={{ padding: '56px 16px', borderRadius: 16, gap: 10 }}>
            <Icon name="search_off" size={30} />
            <span style={{ font: '400 24px var(--serif)' }}>No series found</span>
            <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>Try a shorter search, another genre, or clear the filters.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(140px,14vw,190px),1fr))', gap: '28px 16px', opacity: pending ? .55 : 1, transition: 'opacity .2s' }}>
            {data.items.map(s => (
              <div key={s.id} className="stack" style={{ gap: 10, position: 'relative' }}>
                <Link href={`/series/${s.slug}`} aria-label={s.title}>
                  <Cover bg={coverBg(s.coverHue, s.coverUrl)} className="lift" style={{ width: '100%' }}>
                    <span className="badge dark xs" style={{ position: 'absolute', left: 8, bottom: 8 }}>★ {s.rating.toFixed(1)}</span>
                    {s.status !== 'ongoing' && <span className={`badge xs ${SERIES_STATUS_TONE[s.status]}`} style={{ position: 'absolute', left: 8, top: 8 }}>{SERIES_STATUS_LABEL[s.status].toUpperCase()}</span>}
                  </Cover>
                </Link>
                <BookmarkFab slug={s.slug} title={s.title} />
                <div className="stack" style={{ gap: 4 }}>
                  <Link href={`/series/${s.slug}`} style={{ font: '600 15px/1.3 var(--sans)', color: 'var(--ink-1)' }}>{s.title}</Link>
                  <span className="meta">
                    {s.genres[0]?.name.toUpperCase() ?? 'SERIES'} · {s.latestChapter !== null ? `CH. ${chapterNo(s.latestChapter)}` : 'SOON'} · {compact(s.viewCount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <Pager total={data.total} limit={data.limit} offset={data.offset} path={path}
          params={{ q: filters.q, genre: filters.genre, status: filters.status, sort: filters.sort === 'popular' ? undefined : filters.sort }} />
      </div>
      <Footer />
    </div>
  );
}
