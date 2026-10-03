'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bar, Button, Cover, Icon, Segmented } from '@/components/ui';
import { backdropBg, chapterNo, compact, coverBg, timeAgo } from '@/lib/catalog';
import type { SeriesCardDTO } from '@/server/data/catalog';
import type { ContinueReadingDTO } from '@/server/data/reading';
import { Footer } from './Chrome';
import { useSite } from './store';

export type HomeData = {
  featured: SeriesCardDTO[];
  trending: SeriesCardDTO[];
  updated: (SeriesCardDTO & { recent: { number: number; publishedAt: Date | null; early: boolean }[] })[];
  fresh: SeriesCardDTO[];
  popular: [SeriesCardDTO[], SeriesCardDTO[], SeriesCardDTO[]];
  pick: SeriesCardDTO | null;
  genres: { slug: string; name: string; hue: number; count: number }[];
  continueReading: ContinueReadingDTO[];
};

const HERO_TAGS = ['MOST READ', 'TRENDING', 'POPULAR'];
const primaryGenre = (s: SeriesCardDTO) => s.genres[0]?.name.toUpperCase() ?? 'SERIES';

function SectionHead({ id, title, aside }: { id: string; title: string; aside?: React.ReactNode }) {
  return (
    <div className="row" style={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <h2 id={id} className="section-title">{title}</h2>
      {aside}
    </div>
  );
}

const MoreLink = ({ href, label = 'See all' }: { href: string; label?: string }) => (
  <Link href={href} className="row" style={{ color: 'var(--ink-2)', font: '500 14px var(--sans)', gap: 2 }}>{label}<Icon name="chevron_right" size={18} /></Link>
);

export function BookmarkFab({ slug, title }: { slug: string; title: string }) {
  const { bm, toggleBookmark } = useSite();
  const on = !!bm[slug];
  return (
    <button type="button" className="bm-fab" aria-label={on ? 'Remove bookmark' : 'Bookmark'} aria-pressed={on} onClick={e => { e.stopPropagation(); toggleBookmark(slug, title); }}>
      <Icon name="bookmark" size={18} fill={on} color={on ? 'var(--ember)' : 'var(--ink-1)'} />
    </button>
  );
}

export default function Home({ data }: { data: HomeData }) {
  const router = useRouter();
  const [heroIdx, setHeroIdx] = useState(0);
  const [popTab, setPopTab] = useState(0);
  // Fixed per mount so "NEW" badges don't flip between renders.
  const [now] = useState(() => Date.now());
  const { featured, trending, updated, fresh, popular, pick, genres, continueReading } = data;

  useEffect(() => {
    if (featured.length < 2) return;
    const i = setInterval(() => { if (!document.hidden) setHeroIdx(x => (x + 1) % featured.length); }, 8000);
    return () => clearInterval(i);
  }, [featured.length]);

  if (featured.length === 0) {
    return (
      <div className="page-anim">
        <div className="container stack" style={{ paddingTop: 'clamp(48px,8vw,120px)', alignItems: 'center', textAlign: 'center', gap: 14 }}>
          <span className="kicker accent">Nerio</span>
          <h1 style={{ font: '400 clamp(36px,5vw,64px)/1 var(--serif)' }}>The shelves are being stocked</h1>
          <p style={{ color: 'var(--ink-2)', maxWidth: 440, lineHeight: 1.6 }}>No series are published yet. Check back soon.</p>
        </div>
        <Footer />
      </div>
    );
  }

  const hero = featured[heroIdx % featured.length];

  return (
    <div className="page-anim">
      <div className="container stack" style={{ paddingTop: 'clamp(12px,2vw,24px)', gap: 'clamp(48px,7vw,88px)' }}>

        <section aria-label="Featured" className={`hero ${hero.coverUrl ? '' : 'stripes'}`} style={{ background: backdropBg(hero.coverHue, hero.coverUrl) }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg,rgba(11,11,13,.94) 0%,rgba(11,11,13,.6) 45%,rgba(11,11,13,0) 80%)' }} />
          <div className="row" style={{ position: 'relative', width: '100%', padding: 'clamp(20px,4vw,56px)', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
            <div className="stack" style={{ gap: 18, maxWidth: 640 }}>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <span className="badge new">{HERO_TAGS[heroIdx % HERO_TAGS.length]}</span>
                <span style={{ font: '500 12px var(--mono)', letterSpacing: '.06em', color: 'var(--ink-soft)' }}>{hero.genres.map(g => g.name).join(' · ')}</span>
              </div>
              <h1 style={{ font: '400 clamp(40px,7vw,96px)/.95 var(--serif)', letterSpacing: '-.03em', textWrap: 'balance' }}>{hero.title}</h1>
              <p style={{ fontSize: 'clamp(15px,1.4vw,17px)', lineHeight: 1.6, color: 'var(--ink-soft)', maxWidth: 520, textWrap: 'pretty', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{hero.description}</p>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                {hero.firstChapter !== null && (
                  <Button variant="primary" h={48} px={22} icon="play_arrow" iconFill onClick={() => router.push(`/read/${hero.slug}/${chapterNo(hero.firstChapter!)}`)}>Read chapter {chapterNo(hero.firstChapter)}</Button>
                )}
                <Button variant="outline" h={48} px={20} style={{ background: 'rgba(11,11,13,.4)', borderColor: 'rgba(255,255,255,.22)' }} onClick={() => router.push(`/series/${hero.slug}`)}>Details</Button>
              </div>
            </div>
            <Cover className="desk-only" bg={coverBg(hero.coverHue, hero.coverUrl)} tag={hero.coverUrl ? undefined : 'COVER ART'} width="clamp(200px,17vw,260px)" style={{ boxShadow: '0 30px 60px -20px rgba(0,0,0,.9)', outline: '1px solid rgba(255,255,255,.12)' }} />
          </div>
          {featured.length > 1 && (
            <div role="tablist" aria-label="Featured series" className="row" style={{ position: 'absolute', top: 'clamp(16px,2.4vw,28px)', left: 'clamp(20px,4vw,56px)', gap: 6 }}>
              {featured.map((s, i) => (
                <button key={s.id} type="button" role="tab" aria-selected={i === heroIdx} aria-label={s.title} className="hero-dot" onClick={() => setHeroIdx(i)}
                  style={{ width: i === heroIdx ? 28 : 6, background: i === heroIdx ? 'var(--ink-1)' : 'rgba(237,235,230,.35)' }} />
              ))}
            </div>
          )}
        </section>

        {continueReading.length > 0 && (
          <section aria-labelledby="h-continue" className="stack" style={{ gap: 20 }}>
            <SectionHead id="h-continue" title="Continue reading" aside={<MoreLink href="/profile?tab=history" label="History" />} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', gap: 12 }}>
              {continueReading.map(c => {
                const target = c.nextChapter ?? c.chapterNumber;
                return (
                  <Link key={c.seriesSlug} href={`/read/${c.seriesSlug}/${chapterNo(target)}`} className="card hover-card row" style={{ gap: 14, padding: 12, color: 'var(--ink-1)' }}>
                    <Cover bg={coverBg(c.coverHue, c.coverUrl)} width={64} radius={10} />
                    <div className="stack grow" style={{ gap: 7, minWidth: 0 }}>
                      <span className="ellipsis" style={{ font: '600 15px/1.3 var(--sans)' }}>{c.seriesTitle}</span>
                      <span className="meta">{c.nextChapter !== null ? `UP NEXT · CH. ${chapterNo(c.nextChapter)}` : `CH. ${chapterNo(c.chapterNumber)} · ${c.percent}%`}</span>
                      <Bar pct={c.nextChapter !== null ? 0 : c.percent} />
                    </div>
                    <span className="icon-btn solid round" style={{ '--h': '40px' } as React.CSSProperties}><Icon name="play_arrow" fill /></span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <section aria-labelledby="h-trend" className="stack" style={{ gap: 20 }}>
          <SectionHead id="h-trend" title="Trending" aside={<MoreLink href="/browse?sort=popular" />} />
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,320px),1fr))', gap: '4px 32px' }}>
            {trending.map((s, i) => (
              <li key={s.id} style={{ borderTop: '1px solid var(--line-1)' }}>
                <Link href={`/series/${s.slug}`} className="row-btn" style={{ gap: 16, padding: '14px 0' }}>
                  <span style={{ font: '400 44px/1 var(--serif)', width: 40, textAlign: 'center', color: i < 3 ? 'var(--ember)' : 'var(--ink-5)' }}>{i + 1}</span>
                  <Cover bg={coverBg(s.coverHue, s.coverUrl)} width={56} radius={8} />
                  <div className="stack grow" style={{ gap: 5, minWidth: 0 }}>
                    <span style={{ font: '600 16px/1.3 var(--sans)' }}>{s.title}</span>
                    <span className="ellipsis" style={{ font: '400 13px var(--sans)', color: 'var(--ink-3)' }}>{s.genres.map(g => g.name).join(' · ')}</span>
                    <span className="meta" style={{ color: 'var(--ink-2)' }}>★ {s.rating.toFixed(1)} · {compact(s.viewCount)} READS</span>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        {updated.length > 0 && (
          <section aria-labelledby="h-updated" className="stack" style={{ gap: 20 }}>
            <SectionHead id="h-updated" title="Recently updated" aside={<MoreLink href="/browse?sort=updated" />} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))', gap: 12 }}>
              {updated.map(s => (
                <div key={s.id} className="card row" style={{ gap: 14, padding: 14, alignItems: 'stretch' }}>
                  <Link href={`/series/${s.slug}`} aria-label={s.title} style={{ flex: 'none' }}>
                    <Cover bg={coverBg(s.coverHue, s.coverUrl)} width={76} radius={10} className="lift" />
                  </Link>
                  <div className="stack grow" style={{ gap: 8, minWidth: 0 }}>
                    <Link href={`/series/${s.slug}`} style={{ font: '600 16px/1.3 var(--sans)' }}>{s.title}</Link>
                    {s.recent.map((c, i) => (
                      <Link key={c.number} href={`/read/${s.slug}/${chapterNo(c.number)}`} className="chapter-pill" style={i === 0 ? { background: 'var(--s2)' } : { color: 'var(--ink-2)' }}>
                        <span style={{ font: '500 13px var(--mono)' }}>Ch. {chapterNo(c.number)}</span>
                        <span className="row" style={{ gap: 8 }}>
                          {c.early && <Icon name="lock" size={14} color="var(--ink-3)" />}
                          {i === 0 && c.publishedAt && now - new Date(c.publishedAt).getTime() < 3 * 86_400_000 && <span className="badge new xs">NEW</span>}
                          <span className="meta" suppressHydrationWarning>{timeAgo(c.publishedAt)}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {fresh.length > 0 && (
          <section aria-labelledby="h-new" className="stack" style={{ gap: 20 }}>
            <SectionHead id="h-new" title="New releases" aside={<MoreLink href="/browse?sort=new" />} />
            <div className="hscroll">
              {fresh.map(s => (
                <Link key={s.id} href={`/series/${s.slug}`} className="stack" style={{ flex: 'none', width: 'clamp(136px,14vw,188px)', scrollSnapAlign: 'start', gap: 10, color: 'var(--ink-1)' }}>
                  <Cover bg={coverBg(s.coverHue, s.coverUrl)} className="lift" style={{ width: '100%' }}>
                    {s.publishedAt && <span className="badge dark xs" style={{ position: 'absolute', left: 8, top: 8 }} suppressHydrationWarning>{timeAgo(s.publishedAt).toUpperCase()}</span>}
                  </Cover>
                  <div className="stack" style={{ gap: 4 }}>
                    <span style={{ font: '600 15px/1.3 var(--sans)' }}>{s.title}</span>
                    <span className="meta">{primaryGenre(s)} · {s.chapterCount} CH.</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {pick && (
          <section aria-labelledby="h-pick" className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 'clamp(24px,4vw,56px)', alignItems: 'center', padding: 'clamp(20px,4vw,48px)', borderRadius: 24 }}>
            <div className={pick.coverUrl ? '' : 'stripes'} style={{ position: 'relative', aspectRatio: '16/10', borderRadius: 16, background: backdropBg(pick.coverHue, pick.coverUrl), overflow: 'hidden' }} />
            <div className="stack" style={{ gap: 18 }}>
              <span className="kicker accent">Top rated · ★ {pick.rating.toFixed(1)}</span>
              <h2 id="h-pick" style={{ font: '400 clamp(30px,3.6vw,48px)/1.05 var(--serif)', letterSpacing: '-.02em' }}>{pick.title}</h2>
              <p style={{ font: 'italic 400 clamp(18px,1.8vw,22px)/1.5 var(--serif)', color: 'var(--ink-soft)', textWrap: 'pretty', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{pick.description}</p>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{[pick.author, `${pick.chapterCount} chapters`, pick.genres[0]?.name].filter(Boolean).join(' · ')}</span>
              <div><Button variant="secondary" onClick={() => router.push(`/series/${pick.slug}`)}>Start reading</Button></div>
            </div>
          </section>
        )}

        <section aria-labelledby="h-pop" className="stack" style={{ gap: 20 }}>
          <SectionHead id="h-pop" title="Popular series" aside={<Segmented options={[[0, 'Most read'], [1, 'Top rated'], [2, 'Newest']]} value={popTab} onChange={setPopTab} />} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(140px,14vw,190px),1fr))', gap: '28px 16px' }}>
            {popular[popTab].map(s => (
              <div key={s.id} className="stack" style={{ gap: 10, position: 'relative' }}>
                <Link href={`/series/${s.slug}`} aria-label={s.title}>
                  <Cover bg={coverBg(s.coverHue, s.coverUrl)} className="lift" style={{ width: '100%' }}>
                    <span className="badge dark xs" style={{ position: 'absolute', left: 8, bottom: 8 }}>★ {s.rating.toFixed(1)}</span>
                  </Cover>
                </Link>
                <BookmarkFab slug={s.slug} title={s.title} />
                <div className="stack" style={{ gap: 4 }}>
                  <span style={{ font: '600 15px/1.3 var(--sans)' }}>{s.title}</span>
                  <span className="meta">{primaryGenre(s)} · {compact(s.viewCount)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {genres.length > 0 && (
          <section id="genres" aria-labelledby="h-genres" className="stack" style={{ gap: 20, scrollMarginTop: 80 }}>
            <SectionHead id="h-genres" title="Browse by genre" aside={<MoreLink href="/browse" label="All series" />} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(46%,180px),1fr))', gap: 10 }}>
              {genres.map(g => (
                <Link key={g.slug} href={`/browse?genre=${g.slug}`} className="genre-tile" style={{ color: 'var(--ink-1)' }}>
                  <span style={{ position: 'absolute', right: -18, top: -18, width: 64, height: 64, borderRadius: '50%', background: `oklch(.45 .08 ${g.hue})`, opacity: .5 }} />
                  <span style={{ font: '400 20px var(--serif)', position: 'relative' }}>{g.name}</span>
                  <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)', position: 'relative' }}>{g.count} SERIES</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
      <Footer />
    </div>
  );
}
