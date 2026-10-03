'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon, IconButton, useEscape } from '@/components/ui';
import { chapterNo, coverBg } from '@/lib/catalog';
import { logoutAction } from '@/server/actions/auth';
import { useSite } from './store';

export function Logo() {
  return (
    <Link href="/" aria-label="Nerio home" className="row" style={{ gap: 10, padding: 4, marginLeft: -4, borderRadius: 8 }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--ink-1)', display: 'grid', placeItems: 'center' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--bg)' }} />
      </span>
      <span style={{ font: '400 24px var(--serif)', letterSpacing: '-.01em', color: 'var(--ink-1)' }}>Nerio</span>
    </Link>
  );
}

export function Header() {
  const site = useSite();
  const path = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [, startTransition] = useTransition();
  const viewer = site.viewer;
  const menuRef = useRef<HTMLDivElement>(null);
  useEscape(() => setMenu(false), menu);
  useEffect(() => {
    if (!menu) return;
    const on = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [menu]);

  const nav: [string, string, boolean][] = [
    ['Home', '/', path === '/'],
    ['Browse', '/browse', path === '/browse'],
    ['Library', '/profile?tab=bookmarks', path === '/profile'],
    ['Premium', '/premium', path === '/premium'],
  ];
  const go = (href: string) => { setMenu(false); router.push(href); };
  const items: [string, string, () => void][] = [
    ['person', 'Profile', () => go('/profile')],
    ['notifications', viewer?.unreadNotifications ? `Notifications · ${viewer.unreadNotifications}` : 'Notifications', () => go('/profile?tab=notifications')],
    ['bookmarks', 'Bookmarks', () => go('/profile?tab=bookmarks')],
    ['history', 'History', () => go('/profile?tab=history')],
    ['workspace_premium', site.premium ? 'Premium · active' : 'Get Premium', () => go('/premium')],
    ['settings', 'Settings', () => go('/profile?tab=settings')],
    // Display hint only; /admin is enforced server-side.
    ...(viewer?.isAdmin ? [['admin_panel_settings', 'Admin dashboard', () => go('/admin')] as [string, string, () => void]] : []),
    ['logout', 'Sign out', () => { setMenu(false); startTransition(() => logoutAction()); }],
  ];

  return (
    <header className="site-header">
      <div className="container row" style={{ height: 64, gap: 'clamp(12px,3vw,40px)' }}>
        <Logo />
        <nav aria-label="Primary" className="desk-only row" style={{ gap: 4 }}>
          {nav.map(([label, href, on]) => (
            <Link key={label} href={href} className="nav-link" style={{ color: on ? 'var(--ink-1)' : undefined }}>{label}</Link>
          ))}
        </nav>
        <div className="grow" />
        <IconButton className="mobile-only" icon="search" label="Search" iconSize={22} onClick={() => site.openSearch()} />
        <button type="button" className="header-search not-mobile" onClick={() => site.openSearch()}>
          <Icon name="search" />
          <span className="grow" style={{ textAlign: 'left' }}>Search series, authors</span>
          <span className="kbd">/</span>
        </button>
        {!site.premium && <Link href="/premium" className="premium-pill not-mobile">Premium</Link>}
        {!viewer && (
          <Link href={`/login?next=${encodeURIComponent(path)}`} className="btn btn-secondary" style={{ '--h': '38px', '--px': '14px', '--r': '10px', '--fs': '14px' } as React.CSSProperties}>Sign in</Link>
        )}
        {viewer && <div ref={menuRef} style={{ position: 'relative' }}>
          <button type="button" className="avatar-btn" aria-label={viewer.unreadNotifications ? `Account menu, ${viewer.unreadNotifications} unread notifications` : 'Account menu'} aria-expanded={menu} onClick={() => setMenu(m => !m)} style={{ position: 'relative' }}>
            {viewer.initials}
            {viewer.unreadNotifications > 0 && <span className="unread-dot" aria-hidden />}
          </button>
          {menu && (
            <div role="menu" className="menu" style={{ position: 'absolute', right: 0, top: 50, width: 248, zIndex: 40 }}>
              <div className="stack" style={{ padding: '12px 12px 14px', gap: 2, borderBottom: '1px solid var(--line-1)', marginBottom: 6 }}>
                <span style={{ font: '600 15px var(--sans)' }}>{viewer.displayName}</span>
                <span className="meta">@{viewer.username} · {site.premium ? 'PREMIUM' : 'FREE'}</span>
              </div>
              {items.map(([icon, label, fn]) => (
                <button key={label} type="button" role="menuitem" className="menu-item" onClick={fn}>
                  <Icon name={icon} color="var(--ink-2)" />{label}
                </button>
              ))}
            </div>
          )}
        </div>}
      </div>
    </header>
  );
}

export function TabBar() {
  const site = useSite();
  const path = usePathname();
  const tab = useSearchParams().get('tab');
  const items: { icon: string; label: string; href?: string; on: boolean }[] = [
    { icon: 'home', label: 'Home', href: '/', on: path === '/' },
    { icon: 'search', label: 'Search', on: false },
    { icon: 'bookmarks', label: 'Library', href: '/profile?tab=bookmarks', on: path === '/profile' && tab === 'bookmarks' },
    { icon: 'person', label: 'Profile', href: '/profile', on: (path === '/profile' && tab !== 'bookmarks') || path === '/premium' },
  ];
  return (
    <nav aria-label="Primary" className="tabbar mobile-only">
      {items.map(t => {
        const dot = t.label === 'Profile' && !!site.viewer?.unreadNotifications;
        const inner = <><span style={{ position: 'relative', display: 'inline-flex' }}><Icon name={t.icon} size={24} fill={t.on} />{dot && <span className="unread-dot" aria-hidden />}</span>{t.label}</>;
        const style = { color: t.on ? 'var(--ink-1)' : 'var(--ink-3)' };
        return t.href
          ? <Link key={t.label} href={t.href} aria-current={t.on ? 'page' : undefined} className="tabbar-item" style={style}>{inner}</Link>
          : <button key={t.label} type="button" className="tabbar-item" style={style} onClick={() => site.openSearch()}>{inner}</button>;
      })}
    </nav>
  );
}

type SearchHit = { slug: string; title: string; author: string; coverHue: number; coverUrl: string | null; genres: string[]; latestChapter: number | null };

export function SearchOverlay({ genres }: { genres: { slug: string; name: string }[] }) {
  const site = useSite();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const { open, query, genre } = site.search;
  const [results, setResults] = useState<{ key: string; items: SearchHit[]; total: number } | null>(null);
  const close = () => site.setSearch({ open: false });
  useEscape(close, open);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); site.openSearch(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [site]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  // Debounced server search; stale responses are dropped by the abort.
  const q = query.trim();
  const key = `${q}|${genre ?? ''}`;
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (genre) sp.set('genre', genre);
      fetch(`/api/search?${sp}`, { signal: ctrl.signal })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { items: SearchHit[]; total: number }) => setResults({ key, ...d }))
        .catch(() => { if (!ctrl.signal.aborted) setResults({ key, items: [], total: 0 }); });
    }, q ? 200 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [open, q, genre, key]);
  if (!open) return null;

  const idle = !q && !genre;
  const loading = results?.key !== key;
  const items = results?.items ?? [];
  const browseHref = () => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (genre) sp.set('genre', genre);
    return `/browse${sp.size ? `?${sp}` : ''}`;
  };
  const go = (href: string) => { close(); router.push(href); };

  return (
    <div className="search-scrim" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="search-dialog" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ gap: 10, padding: '0 10px 0 16px', height: 60, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <Icon name="search" color="var(--ink-3)" />
          <input ref={inputRef} value={query} onChange={e => site.setSearch({ query: e.target.value })} placeholder="Search series, authors, tags" aria-label="Search"
            onKeyDown={e => { if (e.key === 'Enter') go(browseHref()); }}
            style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: 'var(--ink-1)', font: '400 17px var(--sans)' }} />
          {loading && <span className="spinner" />}
          <button type="button" className="btn btn-ghost" style={{ '--h': '36px', '--px': '10px', '--fs': '13px' } as React.CSSProperties} onClick={close}>
            <span className="mobile-only">Cancel</span><span className="not-mobile">Esc</span>
          </button>
        </div>
        {genres.length > 0 && (
          <div className="row" style={{ gap: 6, padding: '12px 16px', overflowX: 'auto', scrollbarWidth: 'none', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            {genres.map(g => (
              <button key={g.slug} type="button" aria-pressed={genre === g.slug} className="genre-chip" onClick={() => site.setSearch({ genre: genre === g.slug ? null : g.slug })}>{g.name}</button>
            ))}
          </div>
        )}
        <div style={{ overflowY: 'auto', padding: 8, flex: 1, opacity: loading && results ? .6 : 1, transition: 'opacity .15s' }}>
          {idle && <div className="kicker" style={{ padding: '8px 10px 4px' }}>Recently updated</div>}
          {items.map(s => (
            <button key={s.slug} type="button" className="row-btn" style={{ padding: 10, borderRadius: 12 }} onClick={() => go(`/series/${s.slug}`)}>
              <div style={{ width: 44, flex: 'none', aspectRatio: '3/4', borderRadius: 6, background: coverBg(s.coverHue, s.coverUrl) }} />
              <div className="stack grow" style={{ gap: 3, minWidth: 0 }}>
                <span className="ellipsis" style={{ font: '600 15px var(--sans)' }}>{s.title}</span>
                <span className="ellipsis" style={{ fontSize: 13, color: 'var(--ink-3)' }}>{[s.author, ...s.genres].join(' · ')}</span>
              </div>
              {s.latestChapter !== null && <span className="meta" style={{ color: 'var(--ink-2)' }}>CH. {chapterNo(s.latestChapter)}</span>}
            </button>
          ))}
          {!loading && results && items.length === 0 && (
            <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 8, padding: '40px 16px' }}>
              <Icon name="search_off" size={30} color="var(--ink-3)" />
              <span style={{ font: '400 22px var(--serif)' }}>{q ? `Nothing for “${q}”` : 'Nothing here yet'}</span>
              <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>Try a shorter title, an author name, or clear the genre filter.</span>
            </div>
          )}
          {!idle && results && results.total > items.length && (
            <button type="button" className="row-btn" style={{ padding: '12px 10px', borderRadius: 12, justifyContent: 'center', color: 'var(--ember-text)', font: '600 14px var(--sans)', gap: 4 }} onClick={() => go(browseHref())}>
              See all {results.total} results<Icon name="arrow_forward" size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Footer() {
  const cols: [string, [string, string][]][] = [
    ['Discover', [['Browse', '/browse'], ['New releases', '/browse?sort=new'], ['Genres', '/#genres']]],
    ['Account', [['Library', '/profile?tab=bookmarks'], ['Premium', '/premium'], ['Settings', '/profile?tab=settings']]],
    ['Nerio', [['About', '/'], ['Report an issue', '/'], ['Terms & privacy', '/']]],
  ];
  return (
    <footer style={{ marginTop: 'clamp(64px,8vw,120px)', borderTop: '1px solid var(--line-1)' }}>
      <div className="container" style={{ padding: '48px var(--gutter) 40px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 32 }}>
        <div className="stack" style={{ gap: 12 }}>
          <span style={{ font: '400 26px var(--serif)' }}>Nerio</span>
          <span style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-3)', maxWidth: 260 }}>Translated manhwa, carefully typeset, published chapter by chapter.</span>
        </div>
        {cols.map(([head, links]) => (
          <div key={head} className="stack" style={{ gap: 10 }}>
            <span className="kicker">{head}</span>
            {links.map(([l, h]) => <Link key={l} href={h}>{l}</Link>)}
          </div>
        ))}
      </div>
      <div className="container" style={{ padding: '20px var(--gutter) 32px', font: '400 12px var(--mono)', color: 'var(--ink-4)', borderTop: '1px solid rgba(255,255,255,.05)' }}>© 2026 NERIO</div>
    </footer>
  );
}
