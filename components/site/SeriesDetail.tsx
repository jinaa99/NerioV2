'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bar, Button, Cover, Icon, IconButton, Segmented } from '@/components/ui';
import { SERIES, STATUS_TONE, backdrop, chapterTitle, cover, freeLatest, getSeries, tone } from '@/lib/data';
import { useSite } from './store';

const COMMENTS: [string, string, number, string, number][] = [
  ['M', 'mireu_fan', 111, 'The two-page spread at the bell tower. I scrolled back up three times.', 300],
  ['J', 'jinwoo.k', 110, 'Translation notes on the lamp idioms were really helpful.', 160],
];
const RATINGS: [string, number][] = [['5', 78], ['4', 14], ['3', 5], ['2', 2], ['1', 1]];

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ font: '500 15px var(--sans)' }}>{children}</span>
    </div>
  );
}

export default function SeriesDetail({ id }: { id: string }) {
  const s = getSeries(id)!;
  const site = useSite();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(0);
  const [desc, setDesc] = useState(true);
  const [shown, setShown] = useState(20);

  const bm = !!site.bm[s.id];
  const free = freeLatest(s);
  const readCount = s.progress ? s.progress - 1 : 0;

  let rows = Array.from({ length: s.ch }, (_, i) => i + 1).map(n => {
    const locked = site.isLocked(s, n);
    const read = !!s.progress && n < s.progress;
    const reading = n === s.progress;
    const days = (s.ch - n) * 7;
    return {
      n, title: chapterTitle(n), locked, read, reading, isNew: n === free && s.fresh,
      meta: locked ? `FREE IN ${(n - free) * 3 + 3} DAYS` : reading ? 'READING · 40%' : read ? 'READ' : days === 0 ? s.when.toUpperCase() : days < 30 ? `${days} DAYS AGO` : `${Math.round(days / 30)} MO AGO`,
    };
  });
  if (filter === 1) rows = rows.filter(c => !c.read);
  const q = query.trim().toLowerCase();
  if (q) rows = rows.filter(c => String(c.n).includes(q) || c.title.toLowerCase().includes(q));
  if (desc) rows.reverse();
  const total = rows.length;
  rows = rows.slice(0, shown);
  const similar = SERIES.filter(x => x.id !== s.id && x.genres.some(g => s.genres.includes(g))).slice(0, 6);

  const share = () => {
    try { navigator.clipboard?.writeText(location.href); } catch {}
    site.toast('Series link copied', 'content_copy', 'var(--info)');
  };

  return (
    <div className="page-anim">
      <div className="stripes" style={{ position: 'relative', height: 'clamp(220px,32vw,420px)', background: backdrop(s.hue), overflow: 'hidden' }}>
        <span style={{ position: 'absolute', top: 16, right: 'var(--gutter)', font: '400 10px var(--mono)', color: 'rgba(255,255,255,.5)' }}>BANNER ART</span>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg,#0B0B0D 0%,rgba(11,11,13,.3) 60%,rgba(11,11,13,0) 100%)' }} />
      </div>
      <div className="stack" style={{ maxWidth: 1280, margin: 'clamp(-160px,-12vw,-80px) auto 0', padding: '0 var(--gutter)', position: 'relative', gap: 'clamp(32px,4vw,48px)' }}>
        <div className="row" style={{ gap: 'clamp(20px,3vw,44px)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Cover bg={cover(s.hue)} tag="COVER ART" width="clamp(130px,20vw,260px)" radius={16} style={{ boxShadow: '0 30px 60px -20px rgba(0,0,0,.9)', outline: '1px solid rgba(255,255,255,.1)' }} />
          <div className="stack" style={{ flex: '1 1 380px', minWidth: 0, gap: 14 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className={`badge ${STATUS_TONE[s.status]}`}>{s.status.toUpperCase()}</span>
              <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-2)' }}>{s.ch} CHAPTERS · UPDATED {s.when.toUpperCase()}</span>
            </div>
            <h1 style={{ font: '400 clamp(36px,5.6vw,72px)/.98 var(--serif)', letterSpacing: '-.025em', textWrap: 'balance' }}>{s.title}</h1>
            <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>{s.alt}</span>
            <div className="row" style={{ gap: 'clamp(16px,3vw,32px)', flexWrap: 'wrap', marginTop: 4 }}>
              <Stat label="RATING"><span style={{ fontSize: 17 }}><span style={{ color: 'var(--ember)' }}>★</span> {s.rating} <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>({s.votes})</span></span></Stat>
              <Stat label="AUTHOR">{s.author}</Stat>
              <Stat label="ART">{s.artist}</Stat>
              <Stat label="READS">{s.reads}</Stat>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 'clamp(24px,4vw,56px)', alignItems: 'start' }}>
          <div className="stack" style={{ gap: 20 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <Button variant="primary" h={52} icon="play_arrow" iconFill style={{ flex: '1 1 200px' }} onClick={() => router.push(`/read/${s.id}/${s.progress || 1}`)}>
                {s.progress ? `Continue Ch. ${s.progress}` : 'Start reading'}
              </Button>
              <button type="button" aria-pressed={bm} onClick={() => site.toggleBookmark(s.id)} className="btn btn-secondary"
                style={{ '--h': '52px', '--r': '12px', background: bm ? 'rgba(232,130,95,.1)' : undefined, borderColor: bm ? 'rgba(232,130,95,.4)' : undefined } as React.CSSProperties}>
                <Icon name="bookmark" fill={bm} color={bm ? 'var(--ember)' : undefined} />{bm ? 'Bookmarked' : 'Bookmark'}
              </button>
              <IconButton icon="ios_share" label="Share" h={52} r={12} variant="boxed" onClick={share} />
            </div>
            <div className="card stack" style={{ gap: 8, padding: 16, borderRadius: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', font: '500 13px var(--sans)' }}>
                <span>Your progress</span><span className="mono" style={{ color: 'var(--ink-2)' }}>{readCount} / {s.ch}</span>
              </div>
              <Bar h={4} pct={(readCount / s.ch) * 100} />
            </div>
            <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--ink-2)', textWrap: 'pretty' }}>{s.desc}</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{s.genres.map(g => <span key={g} className="chip">{g}</span>)}</div>

            <div className="card stack" style={{ gap: 16, padding: 20 }}>
              <span className="kicker">Community</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
                {[[s.followers, 'Followers'], [s.comments, 'Comments'], [`#${s.rank}`, s.genres[0].toUpperCase()]].map(([v, l]) => (
                  <div key={l} className="stack" style={{ gap: 2 }}>
                    <span style={{ font: '500 22px var(--mono)', letterSpacing: '-.02em' }}>{v}</span>
                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{l}</span>
                  </div>
                ))}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {RATINGS.map(([star, p]) => (
                  <div key={star} className="row meta" style={{ gap: 10 }}>
                    <span style={{ width: 16 }}>{star}</span>
                    <div className="grow"><Bar h={4} pct={p} color="var(--ink-2)" /></div>
                    <span style={{ width: 34, textAlign: 'right' }}>{p}%</span>
                  </div>
                ))}
              </div>
              <div className="stack" style={{ gap: 12, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14 }}>
                {COMMENTS.map(([initial, name, ch, text, hue]) => (
                  <div key={name} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ width: 28, height: 28, flex: 'none', borderRadius: '50%', background: tone(hue), display: 'grid', placeItems: 'center', font: '600 12px var(--sans)' }}>{initial}</span>
                    <div className="stack" style={{ gap: 3 }}>
                      <span style={{ font: '600 13px var(--sans)' }}>{name} <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)', marginLeft: 6 }}>CH. {ch}</span></span>
                      <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)' }}>{text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <section aria-label="Chapters" className="stack" style={{ gap: 14 }}>
            <div className="row" style={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
              <h2 style={{ font: '400 28px var(--serif)' }}>Chapters</h2>
              <span className="meta">{s.ch} TOTAL · {s.early && !site.premium ? `${s.early} EARLY ACCESS` : 'ALL FREE'}</span>
            </div>
            <Link href={`/read/${s.id}/${free}`} className="row latest-cta">
              <div className="stack grow" style={{ gap: 3 }}>
                <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ember-text)' }}>LATEST FREE CHAPTER</span>
                <span style={{ font: '600 16px var(--sans)', color: 'var(--ink-1)' }}>Ch. {free} · {chapterTitle(free)}</span>
              </div>
              <Icon name="arrow_forward" color="var(--ember-text)" />
            </Link>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="searchbox" style={{ flex: '1 1 180px' }}>
                <Icon name="search" size={18} />
                <input aria-label="Find chapter" value={query} onChange={e => { setQuery(e.target.value); setShown(20); }} placeholder="Chapter number or title" inputMode="search" />
              </label>
              <Segmented h={38} options={[[0, 'All'], [1, 'Unread']]} value={filter} onChange={setFilter} />
              <Button variant="secondary" h={44} px={12} fs={13} icon="swap_vert" aria-label="Toggle sort order" onClick={() => setDesc(d => !d)} style={{ fontWeight: 500, borderColor: 'rgba(255,255,255,.1)' }}>{desc ? 'Newest' : 'Oldest'}</Button>
            </div>
            {total === 0 && (
              <div className="empty" style={{ padding: '36px 16px', borderRadius: 14, gap: 8 }}>
                <Icon name="search_off" size={28} />
                <span style={{ font: '400 20px var(--serif)' }}>No chapter matches “{query}”</span>
                <Button variant="secondary" h={36} px={14} onClick={() => setQuery('')}>Clear search</Button>
              </div>
            )}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map(c => (
                <li key={c.n} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                  <Link href={c.locked ? '/premium' : `/read/${s.id}/${c.n}`} className="row-btn" style={{ padding: '14px 8px', background: c.reading ? 'rgba(232,130,95,.06)' : undefined }}>
                    <span style={{ font: '500 13px var(--mono)', width: 40, flex: 'none', color: c.reading ? 'var(--ember)' : c.read ? 'var(--ink-4)' : 'var(--ink-2)' }}>{c.n}</span>
                    <div className="stack grow" style={{ gap: 3 }}>
                      <span className="ellipsis" style={{ font: `${c.read ? 500 : 600} 15px var(--sans)`, color: c.read ? 'var(--ink-3)' : 'var(--ink-1)' }}>{c.title}</span>
                      <span className="meta">{c.meta}</span>
                    </div>
                    {c.isNew && <span className="badge new xs">NEW</span>}
                    {c.locked && <span className="badge neutral xs" style={{ color: 'var(--ink-1)' }}><Icon name="lock" size={13} />EARLY</span>}
                    {c.reading && <div style={{ width: 48 }}><Bar pct={40} /></div>}
                    {c.read && <Icon name="check" size={18} color="var(--ink-4)" />}
                  </Link>
                </li>
              ))}
            </ul>
            {total > shown && <Button variant="outline" onClick={() => setShown(n => n + 30)} style={{ borderColor: 'rgba(255,255,255,.1)', fontSize: 14 }}>Show more chapters</Button>}
          </section>
        </div>

        <section aria-label="Similar" className="stack" style={{ gap: 20, marginTop: 24, paddingBottom: 64 }}>
          <h2 style={{ font: '400 28px var(--serif)' }}>If you like this</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(130px,13vw,170px),1fr))', gap: '24px 16px' }}>
            {similar.map(x => (
              <Link key={x.id} href={`/series/${x.id}`} className="stack" style={{ gap: 10, color: 'var(--ink-1)' }}>
                <Cover bg={cover(x.hue)} className="lift" style={{ width: '100%' }} />
                <span style={{ font: '600 14px/1.3 var(--sans)' }}>{x.title}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
