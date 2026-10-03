'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastViewport, useToastQueue, type PushToast } from '@/components/ui';
import { saveReaderSettingsAction, setBookmarkAction } from '@/server/actions/library';
import type { ViewerDTO } from '@/server/auth/guards';

export type PayState = 'info' | 'pending' | 'confirmed';
export type ReaderPrefs = {
  width: 'narrow' | 'standard' | 'wide' | 'fit';
  gap: 'none' | 'small' | 'large';
  bg: 'black' | 'dim' | 'paper';
  autoHide: boolean;
};

/** Device-local state. Library data (bookmarks, follows, history) lives on the server. */
type Persisted = {
  pay: PayState;
  plan: number;
  payRef: string;
  reader: ReaderPrefs;
};

const DEFAULTS: Persisted = {
  pay: 'info',
  plan: 0,
  payRef: '',
  reader: { width: 'standard', gap: 'none', bg: 'black', autoHide: true },
};
const KEY = 'nerio:site:v1';

type SiteCtx = Persisted & {
  /** Signed-in user from the server session; null when signed out. */
  viewer: ViewerDTO | null;
  premium: boolean;
  /** Bookmarked series slugs (server state plus optimistic changes). */
  bm: Record<string, boolean>;
  set: (patch: Partial<Persisted> | ((s: Persisted) => Partial<Persisted>)) => void;
  setReader: (patch: Partial<ReaderPrefs>) => void;
  /** Keyed by series slug. Signed-out users are sent to log in. */
  toggleBookmark: (slug: string, title: string) => void;
  /** Send signed-out users to log in, then back here. */
  requireSignIn: (reason: string) => void;
  toast: PushToast;
  toastBottom: string | undefined;
  setToastBottom: (v: string | undefined) => void;
  search: { open: boolean; query: string; genre: string | null };
  openSearch: (genre?: string | null) => void;
  setSearch: (patch: Partial<SiteCtx['search']>) => void;
};

const Ctx = createContext<SiteCtx | null>(null);

export function useSite() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSite must be used inside <SiteProvider>');
  return c;
}

const PERSISTED_KEYS = Object.keys(DEFAULTS) as (keyof Persisted)[];

export function SiteProvider({ viewer, bookmarkedSlugs, children }: { viewer: ViewerDTO | null; bookmarkedSlugs: string[]; children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState<Persisted>(DEFAULTS);
  const [bmOverrides, setBmOverrides] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearchState] = useState({ open: false, query: '', genre: null as string | null });
  const [toastBottom, setToastBottom] = useState<string | undefined>(undefined);
  const { toasts, push, dismiss } = useToastQueue();
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const stored = raw ? JSON.parse(raw) as Partial<Persisted> : {};
      // Older versions also stored library data here; only device-local keys are kept.
      const local = Object.fromEntries(PERSISTED_KEYS.filter(k => k in stored).map(k => [k, stored[k]])) as Partial<Persisted>;
      // Signed-in readers get their synced reader settings over this device's copy.
      const synced = viewer?.readerSettings ?? {};
      const { quality: _q, ...syncedReader } = synced;
      void _q; // legacy option, no longer offered
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from storage
      setState(s => ({ ...s, ...local, reader: { ...s.reader, ...local.reader, ...syncedReader } }));
    } catch {}
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state, hydrated]);

  const set: SiteCtx['set'] = useCallback(patch => setState(s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) })), []);
  // Reader settings follow the account: debounced save of the changed keys.
  const pendingReader = useRef<Partial<ReaderPrefs>>({});
  const readerTimer = useRef(0);
  const signedIn = !!viewer;
  const setReader = useCallback((patch: Partial<ReaderPrefs>) => {
    setState(s => ({ ...s, reader: { ...s.reader, ...patch } }));
    if (!signedIn) return;
    pendingReader.current = { ...pendingReader.current, ...patch };
    clearTimeout(readerTimer.current);
    readerTimer.current = window.setTimeout(() => {
      const settings = pendingReader.current;
      pendingReader.current = {};
      saveReaderSettingsAction(settings).catch(() => {});
    }, 800);
  }, [signedIn]);

  const requireSignIn = useCallback((reason: string) => {
    push(reason, 'login', 'var(--info)');
    router.push(`/login?next=${encodeURIComponent(path)}`);
  }, [push, router, path]);

  const serverBm = useMemo(() => Object.fromEntries(bookmarkedSlugs.map(s => [s, true])), [bookmarkedSlugs]);
  const bm = useMemo(() => ({ ...serverBm, ...bmOverrides }), [serverBm, bmOverrides]);
  const bmRef = useRef(bm);
  useEffect(() => { bmRef.current = bm; });

  const toggleBookmark = useCallback((slug: string, title: string) => {
    if (!signedIn) return requireSignIn('Sign in to save series to your library');
    const apply = (on: boolean, undoable: boolean) => {
      setBmOverrides(o => ({ ...o, [slug]: on }));
      setBookmarkAction(slug, on).then(res => {
        if (res.ok) {
          if (undoable) push(on ? `${title} added to your library` : `${title} removed`, on ? 'bookmark_added' : 'bookmark_remove', on ? 'var(--success)' : 'var(--ink-2)', () => apply(!on, false));
        } else {
          setBmOverrides(o => ({ ...o, [slug]: !on }));
          push(res.error, 'error', 'var(--danger)');
        }
      }).catch(() => {
        setBmOverrides(o => ({ ...o, [slug]: !on }));
        push('Couldn’t update your library. Check your connection.', 'error', 'var(--danger)');
      });
    };
    apply(!bmRef.current[slug], true);
  }, [signedIn, requireSignIn, push]);

  const premium = !!viewer?.premium || state.pay === 'confirmed';
  const setSearch = useCallback((patch: Partial<SiteCtx['search']>) => setSearchState(s => ({ ...s, ...patch })), []);
  const openSearch = useCallback((genre?: string | null) => setSearchState(s => ({ open: true, query: genre !== undefined ? '' : s.query, genre: genre !== undefined ? genre : s.genre })), []);

  const value = useMemo<SiteCtx>(() => ({
    ...state, viewer, premium, bm, set, setReader, toggleBookmark, requireSignIn, toast: push, toastBottom, setToastBottom, search, openSearch, setSearch,
  }), [state, viewer, premium, bm, set, setReader, toggleBookmark, requireSignIn, push, toastBottom, search, openSearch, setSearch]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} bottom={toastBottom} />
    </Ctx.Provider>
  );
}
