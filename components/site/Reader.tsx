'use client';

import { useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Icon, IconButton, Segmented, SwitchRow, useViewportWidth } from '@/components/ui';
import { chapterName, chapterNo, timeAgo } from '@/lib/catalog';
import type { ReaderChapterDTO } from '@/server/data/catalog';
import { useSite, type ReaderPrefs } from './store';

const WIDTHS = { fit: '100%', narrow: '600px', standard: '760px', wide: '1000px' };
const GAPS = { none: '0px', small: '8px', large: '28px' };
const BGS = { black: '#050506', dim: '#111114', paper: '#1C1C20' };
const SHORTCUTS: [string, string][] = [['Next / previous chapter', '→  ←'], ['Scroll down / up', 'J  K  Space'], ['Fullscreen', 'F'], ['Settings', 'S'], ['Chapter list', 'C'], ['Hide interface', 'H'], ['Back to series', 'Esc']];

/** Where on screen "the page you're reading" is measured: 30% down the viewport. */
const ANCHOR = .3;
/** Pages loaded above the current one (for small scroll-backs). */
const BEHIND = 1;
const AUTO_RETRIES = 2;
const SLOW_MS = 7000;
/** Progress is saved at most this often while scrolling, and always this soon after scrolling stops. */
const SAVE_IDLE_MS = 2000;
const SAVE_MAX_WAIT_MS = 15_000;

type SlotState = 'idle' | 'loading' | 'retrying' | 'loaded' | 'error';
type Slot = { state: SlotState; attempt: number };
type Pos = { i: number; frac: number };

/** Pages to keep loaded ahead of the reader, scaled down on slow or metered connections. */
function lookahead(): number {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (c?.saveData || c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g') return 1;
  if (c?.effectiveType === '3g') return 2;
  return 4;
}

const localKey = (chapterId: string) => `nerio:pos:${chapterId}`;
const noSubscribe = () => () => {};
/** iOS Safari has no element fullscreen; hide the control there. */
const useFullscreenSupported = () => useSyncExternalStore(noSubscribe, () => !!document.fullscreenEnabled, () => false);

/* One page: a box with the image's exact aspect ratio (no layout shift), the image once it's wanted, and its loading/error states. */
const PageSlot = memo(function PageSlot({ page, index, slot, high, setEl, onLoad, onError, onRetry }: {
  page: ReaderChapterDTO['pages'][number]; index: number; slot: Slot; high: boolean;
  setEl: (i: number, el: HTMLDivElement | null) => void;
  onLoad: (i: number) => void; onError: (i: number) => void; onRetry: (i: number) => void;
}) {
  const [slow, setSlow] = useState(false);
  const pending = slot.state === 'loading' || slot.state === 'retrying';
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => { clearTimeout(t); setSlow(false); };
  }, [pending, slot.attempt]);

  const label = String(index + 1).padStart(2, '0');
  const showImg = !!page.src && (slot.state === 'loading' || slot.state === 'loaded');
  const failed = slot.state === 'error' || !page.src;

  return (
    <div ref={el => setEl(index, el)} data-page={index + 1} style={{ position: 'relative', width: '100%', aspectRatio: `${page.width} / ${page.height}` }}>
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element -- originals from arbitrary hosts/storage, shown unrecompressed; the box above reserves their exact size
        <img key={slot.attempt} src={page.src!} alt={`Page ${index + 1}`} width={page.width} height={page.height} decoding="async" draggable={false}
          fetchPriority={high ? 'high' : 'low'}
          // Images that finished before hydration never fire onLoad/onError for React; check on mount.
          ref={el => { if (el?.complete && slot.state === 'loading') (el.naturalWidth ? onLoad : onError)(index); }}
          onLoad={() => onLoad(index)} onError={() => onError(index)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', opacity: slot.state === 'loaded' ? 1 : 0, transition: 'opacity .25s' }} />
      )}
      {!failed && slot.state !== 'loaded' && (
        <div className="skeleton" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <span className="row" style={{ gap: 10, font: '400 11px var(--mono)', color: 'var(--ink-4)', position: 'sticky', top: '45vh' }}>
            {pending && <span className="spinner" />}
            {slot.state === 'retrying' ? `RETRYING PAGE ${label}` : slow ? `PAGE ${label} · SLOW CONNECTION, STILL LOADING` : `PAGE ${label}`}
          </span>
        </div>
      )}
      {failed && (
        <div className="stack" style={{ position: 'absolute', inset: 0, background: '#0E0E11', border: '1px dashed rgba(229,103,92,.3)', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', padding: 20 }}>
          <Icon name="broken_image" size={30} color="var(--danger)" />
          <span style={{ font: '600 16px var(--sans)' }}>Page {label} didn’t load</span>
          <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>{page.src ? 'Check your connection. The rest of the chapter is still available.' : 'This page’s image isn’t available yet.'}</span>
          {page.src && <Button variant="secondary" icon="refresh" onClick={e => { e.stopPropagation(); onRetry(index); }}>Retry page</Button>}
        </div>
      )}
    </div>
  );
});

export default function Reader({ chapter }: { chapter: ReaderChapterDTO }) {
  const s = chapter.series;
  const slug = s.slug;
  const ch = chapter.number;
  const pages = chapter.pages;
  const N = pages.length;
  const site = useSite();
  const { reader: prefs, setReader, toast, setToastBottom } = site;
  const signedIn = !!site.viewer;
  const router = useRouter();
  const isMobile = useViewportWidth() < 768;

  // The first pages are wanted from the start (and server-rendered), the rest join the window as the reader approaches.
  const [slots, setSlots] = useState<Slot[]>(() => pages.map((_, i) => ({ state: i < 2 ? 'loading' : 'idle', attempt: 0 })));
  const [current, setCurrent] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<null | 'settings' | 'chapters' | 'shortcuts'>(null);
  const [prog, setProg] = useState(0);
  const [saved, setSaved] = useState(false);
  const [fs, setFs] = useState(false);
  const fsSupported = useFullscreenSupported();
  const [switching, setSwitching] = useState(false);

  const els = useRef<(HTMLDivElement | null)[]>([]);
  const pos = useRef<Pos>({ i: 0, frac: 0 });
  const lastY = useRef(0);
  const ahead = useRef(2);
  const retryTimers = useRef<number[]>([]);
  const preloaded = useRef(false);
  const live = useRef({ panel, autoHide: prefs.autoHide });
  useEffect(() => { live.current = { panel, autoHide: prefs.autoHide }; });

  const nextN = chapter.next;
  const nextLocked = chapter.nextLocked;
  const readHref = (n: number) => `/read/${slug}/${chapterNo(n)}`;

  /* Loading window */

  const want = useCallback((from: number, to: number) => {
    setSlots(prev => {
      let changed = false;
      const next = prev.map((sl, i) => {
        if (i < from || i > to || sl.state !== 'idle') return sl;
        changed = true;
        return { ...sl, state: 'loading' as const };
      });
      return changed ? next : prev;
    });
  }, []);

  const onLoad = useCallback((i: number) => {
    setSlots(prev => (prev[i].state === 'loaded' ? prev : prev.map((sl, k) => (k === i ? { ...sl, state: 'loaded' } : sl))));
  }, []);

  const slotsRef = useRef(slots);
  useEffect(() => { slotsRef.current = slots; });
  const onError = useCallback((i: number) => {
    const sl = slotsRef.current[i];
    if (!sl || sl.state !== 'loading') return;
    const auto = sl.attempt < AUTO_RETRIES;
    const mark = (state: SlotState) => setSlots(prev => prev.map((x, k) => (k === i && x.state === 'loading' ? { ...x, state } : x)));
    if (!auto) return mark('error');
    mark('retrying');
    // Back off, then remount the <img> (new key) so the browser refetches.
    retryTimers.current.push(window.setTimeout(() => {
      setSlots(p => p.map((x, k) => (k === i && x.state === 'retrying' ? { state: 'loading', attempt: x.attempt + 1 } : x)));
    }, 1000 * 2 ** sl.attempt));
  }, []);

  const onRetry = useCallback((i: number) => {
    setSlots(prev => prev.map((x, k) => (k === i ? { state: 'loading', attempt: x.attempt + 1 } : x)));
  }, []);

  const setEl = useCallback((i: number, el: HTMLDivElement | null) => { els.current[i] = el; }, []);

  /** Page under the anchor line, and how far down it the line is (0–1). */
  const measure = useCallback((): Pos => {
    const line = innerHeight * ANCHOR;
    const list = els.current;
    let lo = 0, hi = N - 1, found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const top = list[mid]?.getBoundingClientRect().top ?? 0;
      if (top <= line) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const r = list[found]?.getBoundingClientRect();
    const frac = r && r.height ? Math.min(1, Math.max(0, (line - r.top) / r.height)) : 0;
    return { i: found, frac };
  }, [N]);

  const scrollToPos = useCallback((p: Pos, behavior: ScrollBehavior = 'instant') => {
    const el = els.current[p.i];
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, r.top + scrollY + p.frac * r.height - innerHeight * ANCHOR), behavior });
  }, []);

  /* Progress saving: debounced while scrolling, flushed when the tab hides or the reader closes */

  const saveState = useRef({ pending: null as null | { pageNumber: number; pageOffset: number; percent: number }, last: '', timer: 0, since: 0 });

  const flush = useCallback((beacon = false) => {
    const st = saveState.current;
    clearTimeout(st.timer);
    st.since = 0;
    const p = st.pending;
    if (!p) return;
    st.pending = null;
    const key = `${p.pageNumber}:${p.pageOffset}:${p.percent}`;
    if (key === st.last) return;
    st.last = key;
    try { localStorage.setItem(localKey(chapter.id), JSON.stringify({ ...p, t: Date.now() })); } catch {}
    if (!signedIn) return;
    const body = JSON.stringify({ chapterId: chapter.id, ...p });
    if (beacon && navigator.sendBeacon?.('/api/progress', new Blob([body], { type: 'application/json' }))) return;
    fetch('/api/progress', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
      .then(r => setSaved(r.ok))
      .catch(() => { setSaved(false); st.last = ''; });
  }, [chapter.id, signedIn]);

  const queueSave = useCallback((p: Pos, atEnd: boolean) => {
    if (N === 0) return;
    const st = saveState.current;
    st.pending = {
      pageNumber: p.i + 1,
      pageOffset: Math.round(p.frac * 1000),
      percent: atEnd ? 100 : Math.min(100, Math.round(((p.i + p.frac) / N) * 100)),
    };
    const now = Date.now();
    if (!st.since) st.since = now;
    clearTimeout(st.timer);
    st.timer = window.setTimeout(() => flush(), Math.min(SAVE_IDLE_MS, Math.max(0, SAVE_MAX_WAIT_MS - (now - st.since))));
  }, [N, flush]);

  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') flush(true); };
    const leave = () => flush(true);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    const timers = retryTimers.current;
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      timers.forEach(clearTimeout);
      flush(true);
    };
  }, [flush]);

  /* Navigation */

  const switchTo = (n: number) => {
    flush();
    setSwitching(true);
    setPanel(null);
    router.push(readHref(n));
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
  const exit = () => { flush(); router.push(`/series/${slug}`); };
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen isn’t available here', 'fullscreen', 'var(--info)'));
  };

  /** Near the end: warm the next chapter's route and its first page images. */
  const preloadNext = useCallback(() => {
    if (preloaded.current || nextN === null || nextLocked) return;
    preloaded.current = true;
    router.prefetch(readHref(nextN));
    for (const src of chapter.nextPreload) {
      const img = new Image();
      img.fetchPriority = 'low';
      img.decoding = 'async';
      img.src = src;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readHref only depends on slug
  }, [nextN, nextLocked, chapter.nextPreload, router, slug]);

  /* Mount: window size, scroll restoration, resume */

  useLayoutEffect(() => {
    ahead.current = lookahead();
    const prevRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';

    let target: Pos | null = null;
    if (chapter.resume) target = { i: chapter.resume.pageNumber - 1, frac: chapter.resume.pageOffset / 1000 };
    else {
      try {
        const local = JSON.parse(localStorage.getItem(localKey(chapter.id)) ?? 'null') as { pageNumber: number; pageOffset: number } | null;
        if (local) target = { i: local.pageNumber - 1, frac: local.pageOffset / 1000 };
      } catch {}
    }
    const valid = target && target.i >= 0 && target.i < N && (target.i > 0 || target.frac > .05);
    if (valid && target) {
      const t = target;
      want(Math.max(0, t.i - BEHIND), Math.min(N - 1, t.i + ahead.current));
      pos.current = t;
      setCurrent(t.i);
      scrollToPos(t);
      // Finished chapters restart from the top instead.
      if (t.i === N - 1 && t.frac > .9) window.scrollTo(0, 0);
      else toast(`Resumed at page ${t.i + 1}`, 'history', 'var(--info)', () => { window.scrollTo({ top: 0 }); });
    } else {
      window.scrollTo(0, 0);
      want(0, Math.min(N - 1, ahead.current));
    }
    return () => { history.scrollRestoration = prevRestoration; };
    // Runs once per chapter (the component is keyed by chapter id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the reading position when the page width or gap changes the layout.
  const layoutKey = `${isMobile ? 'm' : prefs.width}-${prefs.gap}`;
  const firstLayout = useRef(true);
  useLayoutEffect(() => {
    if (firstLayout.current) { firstLayout.current = false; return; }
    scrollToPos(pos.current);
  }, [layoutKey, scrollToPos]);

  // Toast offset above the bottom bar
  useEffect(() => { setToastBottom('96px'); return () => setToastBottom(undefined); }, [setToastBottom]);

  // Scroll: current page, loading window, progress, auto-hide chrome
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = scrollY, doc = document.documentElement.scrollHeight - innerHeight;
        const p = doc > 0 ? Math.min(1, y / doc) : 0;
        setProg(p);
        const dy = y - lastY.current;
        const l = live.current;
        if (l.autoHide && !l.panel) {
          // Always show the controls at the end of the chapter, even after a fast scroll down.
          if (p > .97 || dy < -10) setChrome(true);
          else if (dy > 6 && y > 120) setChrome(false);
        }
        lastY.current = y;
        if (N === 0) return;
        const at = measure();
        pos.current = at;
        setCurrent(at.i);
        // Load the visible page, a small buffer above and the lookahead below; never the whole chapter.
        want(Math.max(0, at.i - BEHIND), Math.min(N - 1, at.i + ahead.current));
        if (at.i >= N - 3) preloadNext();
        queueSave(at, p > .98);
      });
    };
    const onFs = () => setFs(!!document.fullscreenElement);
    const onOnline = () => setSlots(prev => prev.map(sl => (sl.state === 'error' ? { state: 'loading', attempt: sl.attempt + 1 } : sl)));
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    window.addEventListener('online', onOnline);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('fullscreenchange', onFs);
      cancelAnimationFrame(raf);
    };
  }, [N, measure, want, preloadNext, queueSave]);

  // Keyboard shortcuts
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') return panel ? setPanel(null) : exit();
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (k === 'j') window.scrollBy({ top: innerHeight * .8, behavior: 'smooth' });
      else if (k === 'k') window.scrollBy({ top: -innerHeight * .8, behavior: 'smooth' });
      else if (k === 'f' && fsSupported) toggleFs();
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

  // Open the chapter drawer at the current chapter.
  const curTocRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (panel === 'chapters') curTocRef.current?.scrollIntoView({ block: 'center' }); }, [panel]);

  const title = chapterName(ch, chapter.title);
  const hidden = !chrome;
  const minutesLeft = Math.max(1, Math.round(((N - current) * 12) / 60));

  const seg = <K extends keyof ReaderPrefs>(label: string, key: K, opts: [ReaderPrefs[K] & string, string][]) => (
    <div key={key} className="stack" style={{ gap: 8 }}>
      <span style={{ font: '500 13px var(--sans)', color: 'var(--ink-2)' }}>{label}</span>
      <Segmented role="radio" label={label} stretch h={38} bg="var(--bg)" options={opts} value={prefs[key] as ReaderPrefs[K] & string} onChange={v => setReader({ [key]: v } as Partial<ReaderPrefs>)} />
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
          <div className="stack grow" style={{ padding: '0 4px', minWidth: 0 }}>
            <span className="ellipsis" style={{ font: '600 14px var(--sans)' }}>{s.title}</span>
            <span className="ellipsis" style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>CH. {chapterNo(ch)}{chapter.title ? ` · ${chapter.title.toUpperCase()}` : ''}</span>
          </div>
          {!isMobile && <IconButton icon="keyboard" label="Keyboard shortcuts" onClick={() => setPanel('shortcuts')} />}
          {!isMobile && fsSupported && <IconButton icon={fs ? 'fullscreen_exit' : 'fullscreen'} label={fs ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFs} />}
          <IconButton icon="tune" label="Reader settings" aria-expanded={panel === 'settings'} onClick={() => setPanel(p => (p === 'settings' ? null : 'settings'))} style={{ background: panel === 'settings' ? 'rgba(255,255,255,.1)' : undefined }} />
        </div>
      </div>

      {/* Tap anywhere on the pages to show/hide the controls; scrolling and pinch-zoom stay native. */}
      <div onClick={() => { if (!panel) setChrome(c => !c); }}
        style={{ maxWidth: isMobile ? '100%' : WIDTHS[prefs.width], margin: '0 auto', display: 'flex', flexDirection: 'column', gap: GAPS[prefs.gap], cursor: 'pointer', opacity: switching ? .3 : 1, transition: 'opacity .2s' }}>
        {N === 0 && (
          <div className="stack" style={{ minHeight: '60vh', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: 24, color: 'var(--ink-3)' }}>
            <Icon name="hide_image" size={30} />
            <span style={{ font: '400 22px var(--serif)', color: 'var(--ink-1)' }}>Pages aren’t available yet</span>
            <span style={{ fontSize: 14 }}>This chapter is published but its pages are still being uploaded.</span>
          </div>
        )}
        {pages.map((p, i) => (
          <PageSlot key={p.id} page={p} index={i} slot={slots[i]} high={Math.abs(i - current) <= 1}
            setEl={setEl} onLoad={onLoad} onError={onError} onRetry={onRetry} />
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
          {chapter.prev !== null && <Button variant="outline" fs={14} icon="arrow_back" onClick={goPrev}>Chapter {chapterNo(chapter.prev)}</Button>}
          <Button variant="outline" fs={14} onClick={exit}>All chapters</Button>
        </div>
      </section>

      <div className="reader-bottom" style={{ transform: hidden ? 'translateY(130%)' : 'none', opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto' }}>
        <div className="reader-bar row" style={{ maxWidth: 600, height: 64, borderRadius: 999, gap: 4, padding: '0 8px', boxShadow: '0 24px 64px -16px rgba(0,0,0,.9)' }}>
          <IconButton icon="skip_previous" label="Previous chapter" variant="round" disabled={chapter.prev === null} onClick={goPrev} style={{ color: chapter.prev === null ? 'var(--ink-5)' : undefined }} />
          <div className="stack grow" style={{ gap: 7, padding: '0 8px', minWidth: 0 }}>
            <input type="range" min={1} max={Math.max(1, N)} value={Math.min(N, current + 1) || 1} aria-label="Page" aria-valuetext={`Page ${current + 1} of ${N}`} disabled={N === 0}
              onChange={e => { const i = +e.target.value - 1; want(Math.max(0, i - BEHIND), Math.min(N - 1, i + ahead.current)); scrollToPos({ i, frac: 0 }); }}
              style={{ width: '100%', height: 20, margin: 0, accentColor: 'var(--ember)', cursor: 'pointer' }} />
            <div className="row" style={{ justifyContent: 'space-between', font: '400 10px var(--mono)', color: 'var(--ink-3)', marginTop: -4 }}>
              <span>PAGE {N ? current + 1 : 0} / {N}</span>
              <span>{saved ? 'PROGRESS SAVED' : `~${minutesLeft} MIN LEFT`}</span>
            </div>
          </div>
          <IconButton icon="format_list_bulleted" label="Chapter list" variant="round" onClick={() => setPanel(p => (p === 'chapters' ? null : 'chapters'))} />
          <IconButton icon={nextLocked ? 'lock' : 'skip_next'} label="Next chapter" variant="solid" disabled={nextN === null} onClick={goNext} />
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
                <button key={n} ref={cur ? curTocRef : undefined} type="button" aria-current={cur ? 'true' : undefined} className="row-btn"
                  style={{ height: 52, padding: '0 12px', gap: 12, background: cur ? 'rgba(232,130,95,.1)' : undefined, color: cur ? 'var(--ember-text)' : 'var(--ink-1)' }}
                  onClick={() => (cur ? setPanel(null) : locked ? router.push('/premium') : switchTo(n))}>
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
            {SHORTCUTS.filter(([l]) => fsSupported || l !== 'Fullscreen').map(([label, key]) => (
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
