'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastViewport, useToastQueue, type PushToast } from '@/components/ui';
import type { ViewerDTO } from '@/server/auth/guards';

export type PayState = 'info' | 'pending' | 'confirmed';
export type ReaderPrefs = {
  width: 'narrow' | 'standard' | 'wide' | 'fit';
  gap: 'none' | 'small' | 'large';
  quality: 'auto' | 'hd' | 'saver';
  bg: 'black' | 'dim' | 'paper';
  autoHide: boolean;
};

type Persisted = {
  bm: Record<string, boolean>;
  follow: Record<string, boolean>;
  prefs: boolean[];
  pay: PayState;
  plan: number;
  payRef: string;
  reader: ReaderPrefs;
};

const DEFAULTS: Persisted = {
  bm: {},
  follow: {},
  prefs: [true, true, false, true],
  pay: 'info',
  plan: 0,
  payRef: '',
  reader: { width: 'standard', gap: 'none', quality: 'auto', bg: 'black', autoHide: true },
};
const KEY = 'nerio:site:v1';

type SiteCtx = Persisted & {
  /** Signed-in user from the server session; null when signed out. */
  viewer: ViewerDTO | null;
  premium: boolean;
  set: (patch: Partial<Persisted> | ((s: Persisted) => Partial<Persisted>)) => void;
  setReader: (patch: Partial<ReaderPrefs>) => void;
  /** Keyed by series slug. */
  toggleBookmark: (slug: string, title: string) => void;
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

export function SiteProvider({ viewer, children }: { viewer: ViewerDTO | null; children: ReactNode }) {
  const [state, setState] = useState<Persisted>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearchState] = useState({ open: false, query: '', genre: null as string | null });
  const [toastBottom, setToastBottom] = useState<string | undefined>(undefined);
  const { toasts, push, dismiss } = useToastQueue();
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from storage
      if (raw) setState(s => ({ ...s, ...JSON.parse(raw) }));
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state, hydrated]);

  const set: SiteCtx['set'] = useCallback(patch => setState(s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) })), []);
  const setReader = useCallback((patch: Partial<ReaderPrefs>) => setState(s => ({ ...s, reader: { ...s.reader, ...patch } })), []);

  const toggleBookmark = useCallback((id: string, title: string) => {
    const on = !stateRef.current.bm[id];
    setState(s => ({ ...s, bm: { ...s.bm, [id]: on } }));
    push(
      on ? `${title} added to your library` : `${title} removed`,
      on ? 'bookmark_added' : 'bookmark_remove',
      on ? 'var(--success)' : 'var(--ink-2)',
      () => setState(s => ({ ...s, bm: { ...s.bm, [id]: !on } })),
    );
  }, [push]);

  const premium = !!viewer?.premium || state.pay === 'confirmed';
  const setSearch = useCallback((patch: Partial<SiteCtx['search']>) => setSearchState(s => ({ ...s, ...patch })), []);
  const openSearch = useCallback((genre?: string | null) => setSearchState(s => ({ open: true, query: genre !== undefined ? '' : s.query, genre: genre !== undefined ? genre : s.genre })), []);

  const value = useMemo<SiteCtx>(() => ({
    ...state, viewer, premium, set, setReader, toggleBookmark, toast: push, toastBottom, setToastBottom, search, openSearch, setSearch,
  }), [state, viewer, premium, set, setReader, toggleBookmark, push, toastBottom, search, openSearch, setSearch]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} bottom={toastBottom} />
    </Ctx.Provider>
  );
}
