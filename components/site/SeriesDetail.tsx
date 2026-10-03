'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Bar, Button, Cover, Icon, IconButton, Segmented } from '@/components/ui';
import { SERIES_STATUS_LABEL, SERIES_STATUS_TONE, backdropBg, chapterName, chapterNo, compact, coverBg, timeAgo } from '@/lib/catalog';
import type { ChapterListItemDTO, Paged, SeriesCardDTO, SeriesDetailDTO } from '@/server/data/catalog';
import { useSite } from './store';

const PAGE = 50;
const DAY = 86_400_000;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ font: '500 15px var(--sans)' }}>{children}</span>
    </div>
  );
}

export default function SeriesDetail({ s, similar }: { s: SeriesDetailDTO; similar: SeriesCardDTO[] }) {
  const site = useSite();
  const router = useRouter();
  const [desc, setDesc] = useState(true);
  const [filter, setFilter] = useState(0);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Paged<ChapterListItemDTO>>(s.chapters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const first = useRef(true);
  // Fixed per mount so "NEW" badges don't flip between renders.
  const [now] = useState(() => Date.now());
  const ctrl = useRef<AbortController | null>(null);

  const bm = !!site.bm[s.slug];
  const progress = s.progress;
  const progressNo = progress?.chapterNumber ?? null;
  const startAt = progressNo ?? s.firstChapter;

  const load = (offset: number) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const sp = new URLSearchParams({ offset: String(offset), limit: String(PAGE), order: desc ? 'desc' : 'asc' });
    if (query.trim()) sp.set('q', query.trim());
    if (filter === 1 && progressNo !== null) sp.set('after', String(progressNo));
    setLoading(true);
    setError(false);
    fetch(`/api/series/${s.slug}/chapters?${sp}`, { signal: c.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Paged<ChapterListItemDTO>) => {
        setList(prev => (offset === 0 ? d : { ...d, items: [...prev.items, ...d.items] }));
        setLoading(false);
      })
      .catch(() => { if (!c.signal.aborted) { setLoading(false); setError(true); } });
  };

  // Refetch from the top when the search, order or filter changes (debounced for typing).
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => load(0), query ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` reads the latest state
  }, [query, desc, filter]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const share = () => {
    try { navigator.clipboard?.writeText(location.href); } catch {}
    site.toast('Series link copied', 'content_copy', 'var(--info)');
  };

  const rowMeta = (c: ChapterListItemDTO, read: boolean, reading: boolean) => {
    if (c.locked) return c.freeAt ? `FREE ${timeAgo(c.freeAt).toUpperCase()}` : 'EARLY ACCESS';
    if (reading) return `READING · ${progress?.percent ?? 0}%`;
    if (read) return 'READ';
    return timeAgo(c.publishedAt).toUpperCase();
  };

  return (
    <div className="page-anim">
      <div className={s.coverUrl ? '' : 'stripes'} style={{ position: 'relative', height: 'clamp(220px,32vw,420px)', background: backdropBg(s.coverHue, s.coverUrl), overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg,#0B0B0D 0%,rgba(11,11,13,.3) 60%,rgba(11,11,13,0) 100%)' }} />
      </div>
      <div className="stack" style={{ maxWidth: 1280, margin: 'clamp(-160px,-12vw,-80px) auto 0', padding: '0 var(--gutter)', position: 'relative', gap: 'clamp(32px,4vw,48px)' }}>
        <div className="row" style={{ gap: 'clamp(20px,3vw,44px)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Cover bg={coverBg(s.coverHue, s.coverUrl)} tag={s.coverUrl ? undefined : 'COVER ART'} width="clamp(130px,20vw,260px)" radius={16} style={{ boxShadow: '0 30px 60px -20px rgba(0,0,0,.9)', outline: '1px solid rgba(255,255,255,.1)' }} />
          <div className="stack" style={{ flex: '1 1 380px', minWidth: 0, gap: 14 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className={`badge ${SERIES_STATUS_TONE[s.status]}`}>{SERIES_STATUS_LABEL[s.status].toUpperCase()}</span>
              <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-2)' }} suppressHydrationWarning>
                {s.chapterCount} CHAPTERS{s.latestChapterAt ? ` · UPDATED ${timeAgo(s.latestChapterAt).toUpperCase()}` : ''}
              </span>
            </div>
            <h1 style={{ font: '400 clamp(36px,5.6vw,72px)/.98 var(--serif)', letterSpacing: '-.025em', textWrap: 'balance' }}>{s.title}</h1>
            {s.altTitles.length > 0 && <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>{s.altTitles.join(' · ')}</span>}
            <div className="row" style={{ gap: 'clamp(16px,3vw,32px)', flexWrap: 'wrap', marginTop: 4 }}>
              <Stat label="RATING"><span style={{ fontSize: 17 }}><span style={{ color: 'var(--ember)' }}>★</span> {s.rating.toFixed(1)} <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>({compact(s.ratingCount)})</span></span></Stat>
              <Stat label="AUTHOR">{s.author}</Stat>
              <Stat label="ART">{s.artist ?? s.author}</Stat>
              <Stat label="READS">{compact(s.viewCount)}</Stat>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 'clamp(24px,4vw,56px)', alignItems: 'start' }}>
          <div className="stack" style={{ gap: 20 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <Button variant="primary" h={52} icon="play_arrow" iconFill style={{ flex: '1 1 200px' }} disabled={startAt === null}
                onClick={() => startAt !== null && router.push(`/read/${s.slug}/${chapterNo(startAt)}`)}>
                {startAt === null ? 'Coming soon' : progressNo !== null ? `Continue Ch. ${chapterNo(progressNo)}` : 'Start reading'}
              </Button>
              <button type="button" aria-pressed={bm} onClick={() => site.toggleBookmark(s.slug, s.title)} className="btn btn-secondary"
                style={{ '--h': '52px', '--r': '12px', background: bm ? 'rgba(232,130,95,.1)' : undefined, borderColor: bm ? 'rgba(232,130,95,.4)' : undefined } as React.CSSProperties}>
                <Icon name="bookmark" fill={bm} color={bm ? 'var(--ember)' : undefined} />{bm ? 'Bookmarked' : 'Bookmark'}
              </button>
              <IconButton icon="ios_share" label="Share" h={52} r={12} variant="boxed" onClick={share} />
            </div>
            {progress && s.latestChapter !== null && (
              <div className="card stack" style={{ gap: 8, padding: 16, borderRadius: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', font: '500 13px var(--sans)' }}>
                  <span>Your progress</span><span className="mono" style={{ color: 'var(--ink-2)' }}>CH. {chapterNo(progress.chapterNumber)} / {chapterNo(s.latestChapter)}</span>
                </div>
                <Bar h={4} pct={(progress.chapterNumber / Math.max(1, s.latestChapter)) * 100} />
              </div>
            )}
            {s.description && <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--ink-2)', textWrap: 'pretty', whiteSpace: 'pre-line' }}>{s.description}</p>}
            {s.genres.length > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {s.genres.map(g => <Link key={g.slug} href={`/browse?genre=${g.slug}`} className="chip">{g.name}</Link>)}
              </div>
            )}
            {s.tags.length > 0 && (
              <div className="row" style={{ gap: '6px 12px', flexWrap: 'wrap' }}>
                {s.tags.map(t => <Link key={t.slug} href={`/browse?q=${encodeURIComponent(t.name)}`} className="meta" style={{ color: 'var(--ink-3)' }}>#{t.name.toUpperCase()}</Link>)}
              </div>
            )}

            <div className="card stack" style={{ gap: 16, padding: 20 }}>
              <span className="kicker">Community</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
                {[[compact(s.followerCount), 'Followers'], [compact(s.ratingCount), 'Ratings'], [compact(s.viewCount), 'Reads']].map(([v, l]) => (
                  <div key={l} className="stack" style={{ gap: 2 }}>
                    <span style={{ font: '500 22px var(--mono)', letterSpacing: '-.02em' }}>{v}</span>
                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <section aria-label="Chapters" className="stack" style={{ gap: 14 }}>
            <div className="row" style={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
              <h2 style={{ font: '400 28px var(--serif)' }}>Chapters</h2>
              <span className="meta">{s.chapterCount} TOTAL · {s.earlyCount && !s.premium ? `${s.earlyCount} EARLY ACCESS` : 'ALL FREE'}</span>
            </div>
            {s.latestFree && (
              <Link href={`/read/${s.slug}/${chapterNo(s.latestFree.number)}`} className="row latest-cta">
                <div className="stack grow" style={{ gap: 3 }}>
                  <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ember-text)' }}>LATEST {s.earlyCount && !s.premium ? 'FREE ' : ''}CHAPTER</span>
                  <span style={{ font: '600 16px var(--sans)', color: 'var(--ink-1)' }}>Ch. {chapterNo(s.latestFree.number)}{s.latestFree.title ? ` · ${s.latestFree.title}` : ''}</span>
                </div>
                <Icon name="arrow_forward" color="var(--ember-text)" />
              </Link>
            )}
            {s.chapterCount > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="searchbox" style={{ flex: '1 1 180px' }}>
                  <Icon name="search" size={18} />
                  <input aria-label="Find chapter" value={query} onChange={e => setQuery(e.target.value)} placeholder="Chapter number or title" inputMode="search" />
                  {loading && <span className="spinner" />}
                </label>
                {progressNo !== null && <Segmented h={38} options={[[0, 'All'], [1, 'Unread']]} value={filter} onChange={setFilter} />}
                <Button variant="secondary" h={44} px={12} fs={13} icon="swap_vert" aria-label="Toggle sort order" onClick={() => setDesc(d => !d)} style={{ fontWeight: 500, borderColor: 'rgba(255,255,255,.1)' }}>{desc ? 'Newest' : 'Oldest'}</Button>
              </div>
            )}
            {s.chapterCount === 0 && (
              <div className="empty" style={{ padding: '36px 16px', borderRadius: 14, gap: 8 }}>
                <Icon name="auto_stories" size={28} />
                <span style={{ font: '400 20px var(--serif)' }}>First chapter coming soon</span>
              </div>
            )}
            {s.chapterCount > 0 && list.total === 0 && !loading && (
              <div className="empty" style={{ padding: '36px 16px', borderRadius: 14, gap: 8 }}>
                <Icon name="search_off" size={28} />
                <span style={{ font: '400 20px var(--serif)' }}>{query ? `No chapter matches “${query}”` : 'You’re all caught up'}</span>
                {query && <Button variant="secondary" h={36} px={14} onClick={() => setQuery('')}>Clear search</Button>}
              </div>
            )}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, opacity: loading && list.items.length ? .6 : 1, transition: 'opacity .15s' }}>
              {list.items.map(c => {
                const read = progressNo !== null && c.number < progressNo;
                const reading = progressNo === c.number;
                const isNew = !c.locked && !!c.publishedAt && now - new Date(c.publishedAt).getTime() < 3 * DAY;
                return (
                  <li key={c.id} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                    <Link href={c.locked ? '/premium' : `/read/${s.slug}/${chapterNo(c.number)}`} className="row-btn" style={{ padding: '14px 8px', background: reading ? 'rgba(232,130,95,.06)' : undefined }}>
                      <span style={{ font: '500 13px var(--mono)', width: 44, flex: 'none', color: reading ? 'var(--ember)' : read ? 'var(--ink-4)' : 'var(--ink-2)' }}>{chapterNo(c.number)}</span>
                      <div className="stack grow" style={{ gap: 3, minWidth: 0 }}>
                        <span className="ellipsis" style={{ font: `${read ? 500 : 600} 15px var(--sans)`, color: read ? 'var(--ink-3)' : 'var(--ink-1)' }}>{chapterName(c.number, c.title)}</span>
                        <span className="meta" suppressHydrationWarning>{rowMeta(c, read, reading)}</span>
                      </div>
                      {isNew && <span className="badge new xs">NEW</span>}
                      {c.locked && <span className="badge neutral xs" style={{ color: 'var(--ink-1)' }}><Icon name="lock" size={13} />EARLY</span>}
                      {reading && <div style={{ width: 48 }}><Bar pct={progress?.percent ?? 0} /></div>}
                      {read && <Icon name="check" size={18} color="var(--ink-4)" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {error && <Button variant="outline" icon="refresh" onClick={() => load(0)} style={{ borderColor: 'rgba(229,103,92,.3)', fontSize: 14 }}>Couldn’t load chapters. Retry</Button>}
            {!error && list.items.length < list.total && (
              <Button variant="outline" loading={loading} onClick={() => load(list.items.length)} style={{ borderColor: 'rgba(255,255,255,.1)', fontSize: 14 }}>
                Show more chapters <span className="meta" style={{ marginLeft: 4 }}>{list.total - list.items.length} LEFT</span>
              </Button>
            )}
          </section>
        </div>

        {similar.length > 0 && (
          <section aria-label="Similar" className="stack" style={{ gap: 20, marginTop: 24, paddingBottom: 64 }}>
            <h2 style={{ font: '400 28px var(--serif)' }}>If you like this</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(130px,13vw,170px),1fr))', gap: '24px 16px' }}>
              {similar.map(x => (
                <Link key={x.id} href={`/series/${x.slug}`} className="stack" style={{ gap: 10, color: 'var(--ink-1)' }}>
                  <Cover bg={coverBg(x.coverHue, x.coverUrl)} className="lift" style={{ width: '100%' }} />
                  <span style={{ font: '600 14px/1.3 var(--sans)' }}>{x.title}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
