'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Icon, IconButton, useEscape } from '@/components/ui';
import { useAdmin } from './store';

export const SECTIONS = {
  overview: { href: '/admin', label: 'Overview', title: 'Overview', icon: 'space_dashboard', group: '' },
  series: { href: '/admin/series', label: 'Series', title: 'Series', icon: 'collections_bookmark', group: 'CONTENT' },
  chapters: { href: '/admin/chapters', label: 'Chapters', title: 'Chapters', icon: 'auto_stories', group: '' },
  upload: { href: '/admin/upload', label: 'Upload', title: 'Upload chapter', icon: 'upload', group: '' },
  queue: { href: '/admin/queue', label: 'Translation queue', title: 'Translation queue', icon: 'translate', group: 'PIPELINE' },
  processing: { href: '/admin/processing', label: 'Processing', title: 'Processing', icon: 'memory', group: '' },
  users: { href: '/admin/users', label: 'Users', title: 'Users & payments', icon: 'group', group: 'PEOPLE' },
  reports: { href: '/admin/reports', label: 'Reports', title: 'Reports', icon: 'flag', group: '' },
  settings: { href: '/admin/settings', label: 'Settings', title: 'Settings', icon: 'settings', group: 'SYSTEM' },
} as const;
type Key = keyof typeof SECTIONS | 'review';

function currentKey(path: string): Key {
  const seg = path.replace(/^\/admin\/?/, '').split('/')[0];
  return (seg || 'overview') as Key;
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const key = currentKey(path);
  const { jobs, pays, reports } = useAdmin();
  const [navOpen, setNavOpen] = useState(false);
  useEscape(() => setNavOpen(false), navOpen);

  const failed = jobs.filter(j => j.status === 'FAILED').length;
  const running = jobs.filter(j => j.status === 'RUNNING').length;
  const counts: Partial<Record<Key, number>> = {
    queue: 5,
    processing: failed || running,
    users: pays.filter(p => p === 'pending').length,
    reports: reports.filter(Boolean).length,
  };
  const title = key === 'review' ? 'Translation review' : SECTIONS[key]?.title ?? 'Admin';
  const crumb = key === 'review' ? 'PIPELINE / QUEUE' : (SECTIONS[key as keyof typeof SECTIONS]?.group || 'NERIO ADMIN');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontSize: 14 }}>
      {navOpen && <div className="scrim admin-scrim" style={{ zIndex: 49 }} onClick={() => setNavOpen(false)} />}
      <aside aria-label="Admin navigation" className={`admin-side ${navOpen ? 'open' : ''}`}>
        <div className="row" style={{ height: 64, gap: 10, padding: '0 20px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          <span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--ink-1)', display: 'grid', placeItems: 'center' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--bg)' }} /></span>
          <span style={{ font: '400 21px var(--serif)' }}>Nerio</span>
          <span className="badge neutral xs" style={{ letterSpacing: '.08em' }}>ADMIN</span>
        </div>
        <nav className="stack" style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', gap: 2 }}>
          {(Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]).map(k => {
            const s = SECTIONS[k];
            const on = key === k || (k === 'queue' && key === 'review');
            const n = counts[k];
            const danger = k === 'processing' && failed > 0;
            return (
              <div key={k} className="stack">
                {s.group && <span style={{ font: '500 10px var(--mono)', letterSpacing: '.1em', color: 'var(--ink-4)', padding: '16px 10px 6px' }}>{s.group}</span>}
                <Link href={s.href} aria-current={on ? 'page' : undefined} className="admin-nav-link" onClick={() => setNavOpen(false)}>
                  <Icon name={s.icon} size={19} />
                  <span className="grow">{s.label}</span>
                  {!!n && <span style={{ font: '500 11px var(--mono)', minWidth: 20, padding: '2px 6px', borderRadius: 999, textAlign: 'center', background: danger ? 'rgba(229,103,92,.18)' : 'rgba(255,255,255,.08)', color: danger ? 'var(--danger-text)' : 'var(--ink-2)' }}>{n}</span>}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="stack" style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,.06)', gap: 10 }}>
          <div className="row" style={{ gap: 8, font: '500 12px var(--mono)', color: 'var(--ink-3)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', animation: 'pulse 2.4s infinite' }} />4 WORKERS ONLINE
          </div>
          <Link href="/" className="row" style={{ gap: 8, font: '500 13px var(--sans)', color: 'var(--ink-2)' }}><Icon name="open_in_new" size={18} />View reader site</Link>
        </div>
      </aside>

      <div className="stack" style={{ flex: 1, minWidth: 0 }}>
        <header className="admin-header row">
          <IconButton className="admin-menu-btn" icon="menu" label="Open navigation" h={40} r={9} onClick={() => setNavOpen(true)} style={{ marginLeft: -8 }} />
          <div className="stack grow">
            <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>{crumb}</span>
            <h1 className="ellipsis" style={{ font: '600 17px var(--sans)' }}>{title}</h1>
          </div>
          <label className="searchbox admin-wide" style={{ width: 260, '--h': '36px', borderRadius: 9, background: 'var(--s2)', padding: '0 10px' } as React.CSSProperties}>
            <Icon name="search" size={18} />
            <input placeholder="Search series, chapters, users" aria-label="Admin search" style={{ fontSize: 13 }} />
            <span className="kbd" style={{ fontSize: 10, padding: '2px 5px', borderRadius: 4 }}>⌘K</span>
          </label>
          <Link href="/admin/upload" className="btn btn-primary" style={{ '--h': '36px', '--px': '12px', '--r': '9px', '--fs': '13px', gap: 6, color: 'var(--bg)' } as React.CSSProperties}>
            <Icon name="upload" size={18} /><span className="admin-wide">Upload chapter</span>
          </Link>
          <span style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', background: 'oklch(.38 .06 200)', display: 'grid', placeItems: 'center', font: '600 13px var(--sans)' }}>JW</span>
        </header>
        <main className="stack" style={{ flex: 1, padding: 'clamp(16px,3vw,32px)', gap: 24, maxWidth: 1600, width: '100%' }}>
          <div key={path} className="stack" style={{ gap: 24, animation: 'rise .3s var(--ease)' }}>{children}</div>
        </main>
      </div>
    </div>
  );
}
