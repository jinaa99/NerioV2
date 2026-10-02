'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bar, Button, Cover, Icon, Segmented } from '@/components/ui';
import { CONTINUE, GENRES, SERIES, backdrop, cover, freeLatest, type Series } from '@/lib/data';
import { Footer } from './Chrome';
import { useSite } from './store';

const FEATURED = [SERIES[0], SERIES[8], SERIES[7]];
const HERO_TAGS = ['NEW CHAPTER', 'TOP RATED', 'ORIGINAL'];
const PREV_WHEN = ['1w ago', '6d ago', '4d ago', '1w ago', '5d ago', '9d ago'];
const readsNum = (s: Series) => parseFloat(s.reads) * (s.reads.includes('M') ? 1000 : 1);
const by = (cmp: (a: Series, b: Series) => number) => [...SERIES].sort(cmp);

function SectionHead({ id, title, aside }: { id: string; title: string; aside?: React.ReactNode }) {
  return (
    <div className="row" style={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <h2 id={id} className="section-title">{title}</h2>
      {aside}
    </div>
  );
}

export function BookmarkFab({ id }: { id: string }) {
  const { bm, toggleBookmark } = useSite();
  const on = !!bm[id];
  return (
    <button type="button" className="bm-fab" aria-label={on ? 'Remove bookmark' : 'Bookmark'} aria-pressed={on} onClick={e => { e.stopPropagation(); toggleBookmark(id); }}>
      <Icon name="bookmark" size={18} fill={on} color={on ? 'var(--ember)' : 'var(--ink-1)'} />
    </button>
  );
}

export default function Home() {
  const site = useSite();
  const router = useRouter();
  const [heroIdx, setHeroIdx] = useState(0);
  const [popTab, setPopTab] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 1100);
    const i = setInterval(() => { if (!document.hidden) setHeroIdx(x => (x + 1) % 3); }, 8000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, []);

  const hero = FEATURED[heroIdx];
  const trending = by((a, b) => a.rank - b.rank).slice(0, 6);
  const updated = by((a, b) => (+b.fresh - +a.fresh) || (a.rank - b.rank)).filter(s => s.status === 'Ongoing').slice(0, 6);
  const newReleases = SERIES.filter(s => s.since).concat([SERIES[3], SERIES[9]]);
  const popular = by([(a: Series, b: Series) => a.rank - b.rank, (a: Series, b: Series) => b.rating - a.rating, (a: Series, b: Series) => readsNum(b) - readsNum(a)][popTab]).slice(0, 12);
  const pick = SERIES[6];

  return (
    <div className="page-anim">
      <div className="container stack" style={{ paddingTop: 'clamp(12px,2vw,24px)', gap: 'clamp(48px,7vw,88px)' }}>

        <section aria-label="Featured" className="hero stripes" style={{ background: backdrop(hero.hue) }}>
          <span style={{ position: 'absolute', top: 20, right: 20, font: '400 10px var(--mono)', letterSpacing: '.08em', color: 'rgba(255,255,255,.5)' }}>KEY ART · 21:9</span>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg,rgba(11,11,13,.94) 0%,rgba(11,11,13,.6) 45%,rgba(11,11,13,0) 80%)' }} />
          <div className="row" style={{ position: 'relative', width: '100%', padding: 'clamp(20px,4vw,56px)', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
            <div className="stack" style={{ gap: 18, maxWidth: 640 }}>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <span className="badge new">{HERO_TAGS[heroIdx]}</span>
                <span style={{ font: '500 12px var(--mono)', letterSpacing: '.06em', color: 'var(--ink-soft)' }}>{hero.genres.join(' · ')}</span>
              </div>
              <h1 style={{ font: '400 clamp(40px,7vw,96px)/.95 var(--serif)', letterSpacing: '-.03em', textWrap: 'balance' }}>{hero.title}</h1>
              <p style={{ fontSize: 'clamp(15px,1.4vw,17px)', lineHeight: 1.6, color: 'var(--ink-soft)', maxWidth: 520, textWrap: 'pretty' }}>{hero.desc}</p>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                <Button variant="primary" h={48} px={22} icon="play_arrow" iconFill onClick={() => router.push(`/read/${hero.id}/1`)}>Read chapter 1</Button>
                <Button variant="outline" h={48} px={20} style={{ background: 'rgba(11,11,13,.4)', borderColor: 'rgba(255,255,255,.22)' }} onClick={() => router.push(`/series/${hero.id}`)}>Details</Button>
              </div>
            </div>
            <Cover className="desk-only" bg={cover(hero.hue)} tag="COVER ART" width="clamp(200px,17vw,260px)" style={{ boxShadow: '0 30px 60px -20px rgba(0,0,0,.9)', outline: '1px solid rgba(255,255,255,.12)' }} />
          </div>
          <div role="tablist" aria-label="Featured series" className="row" style={{ position: 'absolute', top: 'clamp(16px,2.4vw,28px)', left: 'clamp(20px,4vw,56px)', gap: 6 }}>
            {FEATURED.map((s, i) => (
              <button key={s.id} type="button" role="tab" aria-selected={i === heroIdx} aria-label={s.title} className="hero-dot" onClick={() => setHeroIdx(i)}
                style={{ width: i === heroIdx ? 28 : 6, background: i === heroIdx ? 'var(--ink-1)' : 'rgba(237,235,230,.35)' }} />
            ))}
          </div>
        </section>

        <section aria-labelledby="h-continue" className="stack" style={{ gap: 20 }}>
          <SectionHead id="h-continue" title="Continue reading" aside={
            <Link href="/profile?tab=history" className="row" style={{ color: 'var(--ink-2)', font: '500 14px var(--sans)', gap: 2 }}>History<Icon name="chevron_right" size={18} /></Link>
          } />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 12 }}>
            {loading
              ? [1, 2, 3, 4].map(k => <div key={k} className="skeleton" style={{ height: 112, borderRadius: 16 }} />)
              : CONTINUE.map(([id, ch, pct, left]) => {
                const s = SERIES.find(x => x.id === id)!;
                return (
                  <Link key={id} href={`/read/${id}/${ch}`} className="card hover-card row" style={{ gap: 14, padding: 12, color: 'var(--ink-1)' }}>
                    <Cover bg={cover(s.hue)} width={64} radius={10} />
                    <div className="stack grow" style={{ gap: 7 }}>
                      <span className="ellipsis" style={{ font: '600 15px/1.3 var(--sans)' }}>{s.title}</span>
                      <span className="meta">CH. {ch} · {left}</span>
                      <Bar pct={pct} />
                    </div>
                    <span className="icon-btn solid round" style={{ '--h': '40px' } as React.CSSProperties}><Icon name="play_arrow" fill /></span>
                  </Link>
                );
              })}
          </div>
        </section>

        <section aria-labelledby="h-trend" className="stack" style={{ gap: 20 }}>
          <SectionHead id="h-trend" title="Trending this week" aside={<span className="kicker" style={{ letterSpacing: '.08em' }}>Updated hourly</span>} />
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,320px),1fr))', gap: '4px 32px' }}>
            {trending.map((s, i) => (
              <li key={s.id} style={{ borderTop: '1px solid var(--line-1)' }}>
                <Link href={`/series/${s.id}`} className="row-btn" style={{ gap: 16, padding: '14px 0' }}>
                  <span style={{ font: '400 44px/1 var(--serif)', width: 40, textAlign: 'center', color: i < 3 ? 'var(--ember)' : 'var(--ink-5)' }}>{i + 1}</span>
                  <Cover bg={cover(s.hue)} width={56} radius={8} />
                  <div className="stack grow" style={{ gap: 5 }}>
                    <span style={{ font: '600 16px/1.3 var(--sans)' }}>{s.title}</span>
                    <span style={{ font: '400 13px var(--sans)', color: 'var(--ink-3)' }}>{s.genres.join(' · ')}</span>
                    <span className="meta" style={{ color: 'var(--ink-2)' }}>★ {s.rating} · {s.reads} READS</span>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="h-updated" className="stack" style={{ gap: 20 }}>
          <SectionHead id="h-updated" title="Recently updated" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))', gap: 12 }}>
            {updated.map((s, i) => {
              const latest = freeLatest(s);
              return (
                <div key={s.id} className="card row" style={{ gap: 14, padding: 14, alignItems: 'stretch' }}>
                  <Link href={`/series/${s.id}`} aria-label={s.title} style={{ flex: 'none' }}>
                    <Cover bg={cover(s.hue)} width={76} radius={10} className="lift" />
                  </Link>
                  <div className="stack grow" style={{ gap: 8 }}>
                    <Link href={`/series/${s.id}`} style={{ font: '600 16px/1.3 var(--sans)' }}>{s.title}</Link>
                    <Link href={`/read/${s.id}/${latest}`} className="chapter-pill" style={{ background: 'var(--s2)' }}>
                      <span style={{ font: '500 13px var(--mono)' }}>Ch. {latest}</span>
                      <span className="row" style={{ gap: 8 }}>{s.fresh && <span className="badge new xs">NEW</span>}<span className="meta">{s.when}</span></span>
                    </Link>
                    <Link href={`/read/${s.id}/${latest - 1}`} className="chapter-pill" style={{ color: 'var(--ink-2)' }}>
                      <span style={{ font: '500 13px var(--mono)' }}>Ch. {latest - 1}</span>
                      <span className="meta">{PREV_WHEN[i % 6]}</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="h-new" className="stack" style={{ gap: 20 }}>
          <SectionHead id="h-new" title="New releases" aside={<span className="kicker" style={{ letterSpacing: '.08em' }}>Last 30 days</span>} />
          <div className="hscroll">
            {newReleases.map(s => (
              <Link key={s.id} href={`/series/${s.id}`} className="stack" style={{ flex: 'none', width: 'clamp(136px,14vw,188px)', scrollSnapAlign: 'start', gap: 10, color: 'var(--ink-1)' }}>
                <Cover bg={cover(s.hue)} className="lift" style={{ width: '100%' }}>
                  <span className="badge dark xs" style={{ position: 'absolute', left: 8, top: 8 }}>{s.since || '2 MONTHS'}</span>
                </Cover>
                <div className="stack" style={{ gap: 4 }}>
                  <span style={{ font: '600 15px/1.3 var(--sans)' }}>{s.title}</span>
                  <span className="meta">{s.genres[0].toUpperCase()} · {freeLatest(s)} CH.</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="h-pick" className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 'clamp(24px,4vw,56px)', alignItems: 'center', padding: 'clamp(20px,4vw,48px)', borderRadius: 24 }}>
          <div className="stripes" style={{ position: 'relative', aspectRatio: '16/10', borderRadius: 16, background: backdrop(pick.hue), overflow: 'hidden' }}>
            <span className="cover-tag" style={{ left: 14, bottom: 14 }}>PANEL STILL · 16:10</span>
          </div>
          <div className="stack" style={{ gap: 18 }}>
            <span className="kicker accent">Editor’s pick · October</span>
            <h2 id="h-pick" style={{ font: '400 clamp(30px,3.6vw,48px)/1.05 var(--serif)', letterSpacing: '-.02em' }}>{pick.title}</h2>
            <p style={{ font: 'italic 400 clamp(18px,1.8vw,22px)/1.5 var(--serif)', color: 'var(--ink-soft)', textWrap: 'pretty' }}>“A slow, frost-lit coming-of-age where every winter is a chapter. The quietest series we read this year, and the one we couldn’t stop recommending.”</p>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Seo Ga-eun · 35 chapters · Slice of life</span>
            <div><Button variant="secondary" onClick={() => router.push(`/series/${pick.id}`)}>Read the first winter</Button></div>
          </div>
        </section>

        <section aria-labelledby="h-pop" className="stack" style={{ gap: 20 }}>
          <SectionHead id="h-pop" title="Popular series" aside={<Segmented options={[[0, 'Week'], [1, 'Month'], [2, 'All time']]} value={popTab} onChange={setPopTab} />} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(140px,14vw,190px),1fr))', gap: '28px 16px' }}>
            {loading
              ? [1, 2, 3, 4, 5, 6].map(k => (
                <div key={k} className="stack" style={{ gap: 10 }}>
                  <div className="skeleton" style={{ aspectRatio: '3/4', borderRadius: 14 }} />
                  <div style={{ height: 14, width: '80%', borderRadius: 4, background: 'var(--s2)' }} />
                  <div style={{ height: 10, width: '45%', borderRadius: 4, background: 'var(--s2)' }} />
                </div>
              ))
              : popular.map(s => (
                <div key={s.id} className="stack" style={{ gap: 10, position: 'relative' }}>
                  <Link href={`/series/${s.id}`} aria-label={s.title}>
                    <Cover bg={cover(s.hue)} className="lift" style={{ width: '100%' }}>
                      <span className="badge dark xs" style={{ position: 'absolute', left: 8, bottom: 8 }}>★ {s.rating}</span>
                    </Cover>
                  </Link>
                  <BookmarkFab id={s.id} />
                  <div className="stack" style={{ gap: 4 }}>
                    <span style={{ font: '600 15px/1.3 var(--sans)' }}>{s.title}</span>
                    <span className="meta">{s.genres[0].toUpperCase()} · {s.reads}</span>
                  </div>
                </div>
              ))}
          </div>
        </section>

        <section id="genres" aria-labelledby="h-genres" className="stack" style={{ gap: 20, scrollMarginTop: 80 }}>
          <h2 id="h-genres" className="section-title">Browse by genre</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(46%,180px),1fr))', gap: 10 }}>
            {GENRES.map(([name, count, hue]) => (
              <button key={name} type="button" className="genre-tile" onClick={() => site.openSearch(name)}>
                <span style={{ position: 'absolute', right: -18, top: -18, width: 64, height: 64, borderRadius: '50%', background: `oklch(.45 .08 ${hue})`, opacity: .5 }} />
                <span style={{ font: '400 20px var(--serif)', position: 'relative' }}>{name}</span>
                <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)', position: 'relative' }}>{count} SERIES</span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <Footer />
    </div>
  );
}
