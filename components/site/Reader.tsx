'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button, Icon, IconButton, Segmented, SwitchRow, useViewportWidth } from '@/components/ui';
import { chapterName, chapterNo, timeAgo } from '@/lib/catalog';
import { saveProgressAction } from '@/server/actions/reading';
import type { ReaderChapterDTO } from '@/server/data/catalog';
import { useSite, type ReaderPrefs } from './store';

const WIDTHS = { fit: '100%', narrow: '600px', standard: '760px', wide: '1000px' };
const GAPS = { none: '0px', small: '8px', large: '28px' };
const BGS = { black: '#050506', dim: '#111114', paper: '#1C1C20' };
const QUALITY = {
  auto: ['AUTO · 1200W', 'rgba(255,255,255,.18)', 'var(--ink-2)'],
  hd: ['HD · 1600W', 'rgba(123,201,160,.35)', 'var(--success-text)'],
  saver: ['SAVER · 720W', 'rgba(230,194,106,.35)', 'var(--warning-text)'],
} as const;
const SHORTCUTS: [string, string][] = [['Next / previous chapter', '→  ←'], ['Scroll down / up', 'J  K'], ['Fullscreen', 'F'], ['Settings', 'S'], ['Chapter list', 'C'], ['Hide interface', 'H'], ['Back to series', 'Esc']];

export default function Reader({ chapter }: { chapter: ReaderChapterDTO }) {
  const s = chapter.series;
  const id = s.slug;
  const ch = chapter.number;
  const PAGES = chapter.pages.length;
  const site = useSite();
  const { reader: prefs, setReader, premium, toast, setToastBottom } = site;
  const router = useRouter();
  const isMobile = useViewportWidth() < 768;

  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, number>>({});
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<null | 'settings' | 'chapters' | 'shortcuts'>(null);
  const [prog, setProg] = useState(0);
  const [saved, setSaved] = useState(false);
  const [fs, setFs] = useState(false);
  const [switching, setSwitching] = useState(false);
  const lastY = useRef(0);
  const signedIn = !!site.viewer;
  const live = useRef({ panel, chrome, autoHide: prefs.autoHide, locked: chapter.locked, pages: chapter.pages.length });
  useEffect(() => { live.current = { panel, chrome, autoHide: prefs.autoHide, locked: chapter.locked, pages: chapter.pages.length }; });

  const nextN = chapter.next;
  const nextLocked = chapter.nextLocked;

  const switchTo = (n: number) => {
    setSwitching(true);
    setPanel(null);
    setTimeout(() => router.push(`/read/${id}/${chapterNo(n)}`), 380);
  };
  const goNext = () => {
    if (nextN === null) return toast('You’re caught up. Follow the series to hear about new chapters.', 'notifications', 'var(--info)');
    if (nextLocked) {
      setChrome(true);
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      return toast(`Chapter ${chapterNo(nextN)} is early access`, 'lock', 'var(--ember)');
    }
    switchTo(nextN);
  };
  const goPrev = () => { if (chapter.prev !== null) switchTo(chapter.prev); };
  const exit = () => router.push(`/series/${id}`);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen isn’t available here', 'fullscreen', 'var(--info)'));
  };

  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Toast offset above the bottom bar
  useEffect(() => { setToastBottom('96px'); return () => setToastBottom(undefined); }, [setToastBottom]);

  // Scroll: progress, auto-hide chrome, save position
  useEffect(() => {
    let raf = 0;
    let saveT = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY, doc = document.documentElement.scrollHeight - innerHeight;
        const p = doc > 0 ? Math.min(1, y / doc) : 0;
        setProg(p);
        const dy = y - lastY.current;
        const l = live.current;
        if (l.autoHide && !l.panel) {
          if (dy > 6 && y > 120) setChrome(false);
          else if (dy < -10 || p > .97) setChrome(true);
        }
        lastY.current = y;
        clearTimeout(saveT);
        if (!signedIn || l.locked || l.pages === 0) return;
        saveT = window.setTimeout(() => {
          const pageNo = Math.max(1, Math.min(l.pages, Math.ceil(p * l.pages) || 1));
          saveProgressAction(chapter.id, pageNo, Math.round(p * 100)).then(r => setSaved(r.ok)).catch(() => setSaved(false));
        }, 1500);
      });
    };
    const onFs = () => setFs(!!document.fullscreenElement);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('scroll', onScroll); document.removeEventListener('fullscreenchange', onFs); cancelAnimationFrame(raf); clearTimeout(saveT); };
  }, [chapter.id, signedIn]);

  // Keyboard shortcuts
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = e => {
      if (e.key === 'Escape') return panel ? setPanel(null) : exit();
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (k === 'j') window.scrollBy({ top: innerHeight * .8, behavior: 'smooth' });
      else if (k === 'k') window.scrollBy({ top: -innerHeight * .8, behavior: 'smooth' });
      else if (k === 'f') toggleFs();
      else if (k === 's') { setPanel(p => (p === 'settings' ? null : 'settings')); setChrome(true); }
      else if (k === 'c') setPanel(p => (p === 'chapters' ? null : 'chapters'));
      else if (k === 'h') setChrome(c => !c);
      else if (e.key === '?') setPanel(p => (p === 'shortcuts' ? null : 'shortcuts'));
    };
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const [qLabel, qBorder, qColor] = QUALITY[prefs.quality];
  const page = Math.max(1, Math.min(PAGES, Math.ceil(prog * PAGES * 1.08) || 1));
  const title = chapterName(ch, chapter.title);
  const hidden = !chrome;

  const pages = chapter.pages.map((p, i) => ({
    ...p,
    label: String(i + 1).padStart(2, '0'),
    ar: `${p.width}/${p.height}`,
    ok: !!loaded[p.id],
    errored: !p.src || failed[p.id] > 0,
    // Bumped on retry so the <img> remounts and refetches.
    attempt: failed[p.id] ?? 0,
  }));
  const retry = (pid: string) => { setFailed(f => ({ ...f, [pid]: -(Math.abs(f[pid] ?? 0) + 1) })); };

  const seg = <K extends keyof ReaderPrefs>(label: string, key: K, opts: [ReaderPrefs[K] & string, string][], note?: string) => (
    <div key={key} className="stack" style={{ gap: 8 }}>
      <span style={{ font: '500 13px var(--sans)', color: 'var(--ink-2)' }}>{label}</span>
      <Segmented role="radio" label={label} stretch h={38} bg="var(--bg)" options={opts} value={prefs[key] as ReaderPrefs[K] & string} onChange={v => setReader({ [key]: v } as Partial<ReaderPrefs>)} />
      {note && <span className="meta">{note}</span>}
    </div>
  );

  if (chapter.locked) {
    return (
      <main className="stack" style={{ minHeight: '100vh', background: 'var(--bg-reader)', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
        <Icon name="lock" size={32} color="var(--ember)" />
        <h1 style={{ font: '400 clamp(28px,4vw,40px)/1.1 var(--serif)' }}>Chapter {chapterNo(ch)} is in early access</h1>
        <p style={{ fontSize: 15, color: 'var(--ink-2)', maxWidth: 420, lineHeight: 1.6 }} suppressHydrationWarning>
          {chapter.freeAt ? `Free for everyone ${timeAgo(chapter.freeAt)}` : 'Free for everyone soon'}, or read it now with Premium.
        </p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button variant="accent" h={48} onClick={() => router.push('/premium')}>Unlock with Premium</Button>
          <Button variant="outline" h={48} onClick={exit}>Back to series</Button>
        </div>
      </main>
    );
  }

  return (
    <main aria-label="Chapter reader" style={{ background: BGS[prefs.bg], minHeight: '100vh', transition: 'background .3s' }}>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 41, background: 'rgba(255,255,255,.04)' }}>
        <div style={{ height: '100%', width: `${(prog * 100).toFixed(1)}%`, background: 'var(--ember)', transition: 'width .12s linear' }} />
      </div>

      <div className="reader-top" style={{ transform: hidden ? 'translateY(-110%)' : 'none', opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto' }}>
        <div className="reader-bar row" style={{ maxWidth: 960, height: 56, borderRadius: 16, gap: 4, padding: '0 6px' }}>
          <IconButton icon="arrow_back" label="Back to series" onClick={exit} />
          <div className="stack grow" style={{ padding: '0 4px' }}>
            <span className="ellipsis" style={{ font: '600 14px var(--sans)' }}>{s.title}</span>
            <span className="ellipsis" style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>CH. {chapterNo(ch)}{chapter.title ? ` · ${chapter.title.toUpperCase()}` : ''}</span>
          </div>
          <span title="Image quality" style={{ font: '600 10px var(--mono)', padding: '4px 7px', borderRadius: 6, border: `1px solid ${qBorder}`, color: qColor, whiteSpace: 'nowrap' }}>{qLabel}</span>
          {!isMobile && <>
            <IconButton icon="keyboard" label="Keyboard shortcuts" onClick={() => setPanel('shortcuts')} />
            <IconButton icon={fs ? 'fullscreen_exit' : 'fullscreen'} label="Fullscreen" onClick={toggleFs} />
          </>}
          <IconButton icon="tune" label="Reader settings" aria-expanded={panel === 'settings'} onClick={() => setPanel(p => (p === 'settings' ? null : 'settings'))} style={{ background: panel === 'settings' ? 'rgba(255,255,255,.1)' : undefined }} />
        </div>
      </div>

      <div onClick={() => { if (!panel) setChrome(c => !c); }}
        style={{ maxWidth: isMobile ? '100%' : WIDTHS[prefs.width], margin: '0 auto', display: 'flex', flexDirection: 'column', gap: GAPS[prefs.gap], transition: 'max-width .3s var(--ease), gap .3s', cursor: 'pointer', opacity: switching ? .3 : 1 }}>
        {pages.length === 0 && (
          <div className="stack" style={{ minHeight: '60vh', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: 24, color: 'var(--ink-3)' }}>
            <Icon name="hide_image" size={30} />
            <span style={{ font: '400 22px var(--serif)', color: 'var(--ink-1)' }}>Pages aren’t available yet</span>
            <span style={{ fontSize: 14 }}>This chapter is published but its pages are still being uploaded.</span>
          </div>
        )}
        {pages.map((p, i) => (
          <div key={p.id} data-page={p.pageNumber} style={{ position: 'relative', width: '100%', aspectRatio: p.ar }}>
            {p.src && !(p.attempt > 0) && (
              // eslint-disable-next-line @next/next/no-img-element -- page images come from arbitrary hosts/storage; sizes are known so there is no layout shift
              <img key={p.attempt} src={p.src} alt={`Page ${i + 1}`} width={p.width} height={p.height} loading={i < 3 ? 'eager' : 'lazy'} decoding="async"
                fetchPriority={i === 0 ? 'high' : undefined}
                onLoad={() => setLoaded(l => ({ ...l, [p.id]: true }))}
                onError={() => setFailed(f => ({ ...f, [p.id]: Math.abs(f[p.id] ?? 0) + 1 }))}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', opacity: p.ok ? 1 : 0, transition: 'opacity .3s' }} />
            )}
            {!p.ok && !p.errored && (
              <div className="skeleton" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: undefined, pointerEvents: 'none' }}>
                <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-4)' }}>LOADING PAGE {p.label}</span>
              </div>
            )}
            {p.errored && (
              <div className="stack" style={{ position: 'absolute', inset: 0, background: '#0E0E11', border: '1px dashed rgba(229,103,92,.3)', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', padding: 20 }}>
                <Icon name="broken_image" size={30} color="var(--danger)" />
                <span style={{ font: '600 16px var(--sans)' }}>Page {p.label} didn’t load</span>
                <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>The rest of the chapter is still available.</span>
                {p.src && <Button variant="secondary" icon="refresh" onClick={e => { e.stopPropagation(); retry(p.id); }}>Retry page</Button>}
              </div>
            )}
          </div>
        ))}
      </div>

      <section aria-label="End of chapter" className="stack" style={{ maxWidth: 640, margin: '0 auto', padding: '64px 20px 160px', gap: 24, alignItems: 'center', textAlign: 'center' }}>
        <span className="kicker">End of chapter {chapterNo(ch)}</span>
        <h2 style={{ font: '400 clamp(28px,4vw,40px)/1.1 var(--serif)' }}>{title}</h2>
        {nextN !== null && nextLocked && (
          <div className="stack" style={{ width: '100%', padding: 24, borderRadius: 20, background: 'var(--s1)', border: '1px solid rgba(255,255,255,.08)', gap: 12, alignItems: 'center' }}>
            <Icon name="lock" size={28} color="var(--ember)" />
            <span style={{ font: '600 17px var(--sans)' }}>Chapter {chapterNo(nextN)} is in early access</span>
            <span style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>Free for everyone soon, or read it now with Premium.</span>
            <Button variant="accent" h={48} px={22} style={{ marginTop: 4 }} onClick={() => router.push('/premium')}>Unlock with Premium</Button>
          </div>
        )}
        {nextN !== null && !nextLocked && (
          <Button variant="primary" h={56} r={14} fs={16} style={{ width: '100%' }} onClick={goNext}>Next: Chapter {chapterNo(nextN)}<Icon name="arrow_forward" /></Button>
        )}
        {nextN === null && <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>You’re caught up. New chapters appear on the series page.</span>}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button variant="outline" fs={14} onClick={exit}>All chapters</Button>
        </div>
      </section>

      <div className="reader-bottom" style={{ transform: hidden ? 'translateY(130%)' : 'none', opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto' }}>
        <div className="reader-bar row" style={{ maxWidth: 600, height: 64, borderRadius: 999, gap: 4, padding: '0 8px', boxShadow: '0 24px 64px -16px rgba(0,0,0,.9)' }}>
          <IconButton icon="skip_previous" label="Previous chapter" variant="round" disabled={chapter.prev === null} onClick={goPrev} style={{ color: chapter.prev === null ? 'var(--ink-5)' : undefined }} />
          <div className="stack grow" style={{ gap: 7, padding: '0 8px' }}>
            <input type="range" min={0} max={1000} value={Math.round(prog * 1000)} aria-label="Chapter position"
              onChange={e => { const doc = document.documentElement.scrollHeight - innerHeight; window.scrollTo({ top: (+e.target.value / 1000) * doc }); }}
              style={{ width: '100%', height: 20, margin: 0, accentColor: 'var(--ember)', cursor: 'pointer' }} />
            <div className="row" style={{ justifyContent: 'space-between', font: '400 10px var(--mono)', color: 'var(--ink-3)', marginTop: -4 }}>
              <span>PAGE {PAGES ? page : 0} / {PAGES}</span>
              <span>{saved ? 'PROGRESS SAVED' : `~${Math.max(1, Math.round((1 - prog) * Math.max(1, PAGES * .25)))} MIN LEFT`}</span>
            </div>
          </div>
          <IconButton icon="format_list_bulleted" label="Chapter list" variant="round" onClick={() => setPanel(p => (p === 'chapters' ? null : 'chapters'))} />
          <IconButton icon={nextLocked ? 'lock' : 'skip_next'} label="Next chapter" variant="solid" onClick={goNext} />
        </div>
      </div>

      {switching && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 45, display: 'grid', placeItems: 'center', pointerEvents: 'none', animation: 'fade .2s' }}>
          <div className="row" style={{ padding: '14px 18px', borderRadius: 14, background: 'rgba(23,23,27,.96)', border: '1px solid rgba(255,255,255,.1)', gap: 12, font: '500 14px var(--sans)' }}>
            <span className="spinner" />Loading chapter
          </div>
        </div>
      )}

      {panel === 'settings' && <>
        <div className="scrim" style={{ background: 'rgba(5,5,6,.5)' }} onClick={() => setPanel(null)} />
        <div role="dialog" aria-label="Reader settings" className={`reader-settings ${isMobile ? 'sheet' : ''}`}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ font: '400 22px var(--serif)' }}>Reading settings</span>
            <IconButton icon="close" label="Close" h={40} onClick={() => setPanel(null)} style={{ color: 'var(--ink-2)' }} />
          </div>
          {!isMobile && seg('Page width', 'width', [['narrow', 'Narrow'], ['standard', 'Standard'], ['wide', 'Wide'], ['fit', 'Fit']])}
          {seg('Gap between pages', 'gap', [['none', 'None'], ['small', 'Small'], ['large', 'Large']])}
          {seg('Image quality', 'quality', [['auto', 'Auto'], ['hd', 'HD'], ['saver', 'Data saver']], QUALITY[prefs.quality][0] + (prefs.quality === 'hd' && !premium ? ' · PREMIUM, PREVIEW ONLY' : ''))}
          {seg('Background', 'bg', [['black', 'Black'], ['dim', 'Dim'], ['paper', 'Grey']])}
          <SwitchRow on={prefs.autoHide} onToggle={() => setReader({ autoHide: !prefs.autoHide })} label="Hide controls while scrolling" style={{ padding: '4px 0' }} />
        </div>
      </>}

      {panel === 'chapters' && <>
        <div className="scrim" onClick={() => setPanel(null)} />
        <aside aria-label="Chapters" className="stack" style={{ position: 'fixed', zIndex: 51, top: 0, right: 0, bottom: 0, width: 'min(380px,100%)', background: 'var(--s1)', borderLeft: '1px solid rgba(255,255,255,.08)', animation: 'drawer .28s var(--ease)' }}>
          <div className="row" style={{ justifyContent: 'space-between', padding: '16px 16px 12px 20px', borderBottom: '1px solid var(--line-1)' }}>
            <div className="stack"><span style={{ font: '400 22px var(--serif)' }}>Chapters</span><span className="meta">{s.title}</span></div>
            <IconButton icon="close" label="Close" onClick={() => setPanel(null)} style={{ color: 'var(--ink-2)' }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {chapter.toc.map(({ number: n, title: t, locked }) => {
              const cur = n === ch;
              return (
                <button key={n} type="button" className="row-btn" style={{ height: 52, padding: '0 12px', gap: 12, background: cur ? 'rgba(232,130,95,.1)' : undefined, color: cur ? 'var(--ember-text)' : 'var(--ink-1)' }}
                  onClick={() => (locked ? router.push('/premium') : switchTo(n))}>
                  <span style={{ font: '500 13px var(--mono)', width: 44 }}>{chapterNo(n)}</span>
                  <span className="grow ellipsis" style={{ font: '500 14px var(--sans)' }}>{chapterName(n, t)}</span>
                  <Icon name={locked ? 'lock' : cur ? 'play_arrow' : ''} size={16} color="var(--ink-3)" />
                </button>
              );
            })}
          </div>
        </aside>
      </>}

      {panel === 'shortcuts' && (
        <div className="scrim" style={{ background: 'rgba(5,5,6,.7)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={() => setPanel(null)}>
          <div role="dialog" aria-label="Keyboard shortcuts" className="stack" style={{ width: 'min(420px,100%)', padding: 24, borderRadius: 20, background: 'var(--s2)', border: '1px solid rgba(255,255,255,.1)', gap: 6, animation: 'pop .24s var(--ease)' }}>
            <span style={{ font: '400 24px var(--serif)', marginBottom: 10 }}>Keyboard shortcuts</span>
            {SHORTCUTS.map(([label, key]) => (
              <div key={label} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{label}</span>
                <span className="kbd" style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6 }}>{key}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
