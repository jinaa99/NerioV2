'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import Pager from '@/components/Pager';
import { Bar, Button, Cover, Icon, IconButton, SwitchRow } from '@/components/ui';
import { chapterName, chapterNo, coverBg, timeAgo } from '@/lib/catalog';
import { PROFILE_TABS, type ProfileTab } from '@/lib/profile';
import { logoutOtherDevicesAction, updateAccountAction, type FormState } from '@/server/actions/auth';
import { clearHistoryAction, markNotificationsReadAction, savePreferencesAction, setFollowAction } from '@/server/actions/library';
import type { BookmarkDTO, FollowDTO, LibrarySummaryDTO, Paged } from '@/server/data/library';
import type { NotificationDTO } from '@/server/data/notifications';
import type { ContinueReadingDTO, HistoryItemDTO } from '@/server/data/reading';
import { useSite } from './store';

const TABS = PROFILE_TABS;
type Tab = ProfileTab;

export type ProfileAccount = { email: string; displayName: string; username: string; emailOnNewChapter: boolean; showActivity: boolean };
export type ProfileTabData =
  | { tab: 'overview'; continueReading: ContinueReadingDTO[]; recentReads: Date[] }
  | { tab: 'bookmarks'; page: Paged<BookmarkDTO> }
  | { tab: 'history'; page: Paged<HistoryItemDTO> }
  | { tab: 'following'; page: Paged<FollowDTO> }
  | { tab: 'notifications'; page: Paged<NotificationDTO> & { unread: number } }
  | { tab: 'achievements' }
  | { tab: 'settings' };

const noSubscribe = () => () => {};
/** False during SSR and hydration; dates are grouped in the reader's own timezone only after that. */
const useMounted = () => useSyncExternalStore(noSubscribe, () => true, () => false);

const pageParams = (tab: Tab) => ({ tab });

function Empty({ icon, title, text, action }: { icon: string; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty" style={{ padding: '56px 16px' }}>
      <Icon name={icon} size={34} />
      <span style={{ font: '400 24px var(--serif)' }}>{title}</span>
      <span style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 320, lineHeight: 1.5 }}>{text}</span>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

function achievementsFor(s: LibrarySummaryDTO, premium: boolean): [string, string, string, number][] {
  const step = (v: number, target: number) => Math.min(1, v / target);
  return [
    ['auto_stories', 'First chapter', 'Finish your first chapter', step(s.chaptersRead, 1)],
    ['menu_book', 'Bookworm', `Finish 100 chapters · ${Math.min(s.chaptersRead, 100)}/100`, step(s.chaptersRead, 100)],
    ['travel_explore', 'Explorer', `Start 10 different series · ${Math.min(s.seriesStarted, 10)}/10`, step(s.seriesStarted, 10)],
    ['explore', 'Genre hopper', `Read 8 different genres · ${Math.min(s.genresRead, 8)}/8`, step(s.genresRead, 8)],
    ['collections_bookmark', 'Collector', `Bookmark 10 series · ${Math.min(s.bookmarks, 10)}/10`, step(s.bookmarks, 10)],
    ['notifications_active', 'Loyal reader', `Follow 5 series · ${Math.min(s.following, 5)}/5`, step(s.following, 5)],
    ['workspace_premium', 'Patron', 'Support Nerio with Premium', premium ? 1 : 0],
  ];
}

export default function Profile({ account, summary, data }: { account: ProfileAccount; summary: LibrarySummaryDTO; data: ProfileTabData }) {
  const site = useSite();
  const router = useRouter();
  const tab = data.tab;
  const [navigating, startNav] = useTransition();
  const setTab = (t: Tab) => startNav(() => router.push(t === 'overview' ? '/profile' : `/profile?tab=${t}`, { scroll: false }));
  const [saved, saveAction, saving] = useActionState<FormState, FormData>(updateAccountAction, {});
  const [signingOut, startSignOut] = useTransition();
  const viewer = site.viewer;
  const name = viewer?.displayName ?? account.displayName;
  const handle = viewer?.username ?? account.username;
  const { toast } = site;
  useEffect(() => {
    if (saved.ok) toast('Account updated');
    else if (saved.error) toast(saved.error, 'error', 'var(--danger)');
  }, [saved, toast]);
  const fieldError = (k: string) => saved.fields?.[k]?.[0];

  const achievements = achievementsFor(summary, site.premium);
  const stats: [number, string][] = [[summary.chaptersRead, 'Chapters read'], [summary.seriesStarted, 'Series started'], [summary.bookmarks, 'In your library'], [summary.following, 'Following']];

  return (
    <div className="page-anim stack" style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(28px,5vw,64px) var(--gutter) 64px', gap: 'clamp(28px,4vw,44px)' }}>
      <div className="row" style={{ gap: 'clamp(16px,3vw,28px)', flexWrap: 'wrap' }}>
        <div style={{ width: 'clamp(72px,10vw,112px)', aspectRatio: '1', borderRadius: '50%', background: 'oklch(.38 .06 40)', display: 'grid', placeItems: 'center', font: '400 clamp(32px,4vw,48px) var(--serif)', outline: '1px solid rgba(255,255,255,.14)', outlineOffset: 4 }}>{viewer?.initials ?? name[0]?.toUpperCase()}</div>
        <div className="stack" style={{ flex: '1 1 220px', gap: 6 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ font: '400 clamp(30px,4vw,44px)/1 var(--serif)', letterSpacing: '-.02em' }}>{name}</h1>
            <span className={`badge ${site.premium ? 'ember' : 'neutral'}`}>{site.premium ? 'PREMIUM' : 'FREE'}</span>
          </div>
          <span style={{ font: '400 13px var(--mono)', color: 'var(--ink-3)' }}>@{handle}{viewer ? ` · READING SINCE ${viewer.memberSince}` : ''}</span>
        </div>
        <Button variant="secondary" icon="edit" fs={14} onClick={() => setTab('settings')}>Edit profile</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(46%,180px),1fr))', gap: 10 }}>
        {stats.map(([v, l]) => (
          <div key={l} className="card stack" style={{ padding: 18, gap: 6 }}>
            <span style={{ font: '500 clamp(24px,3vw,32px)/1 var(--mono)', letterSpacing: '-.03em' }}>{v.toLocaleString('en-US')}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{l}</span>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Profile sections" className="tabs" style={{ margin: '0 calc(-1 * var(--gutter))', padding: '0 var(--gutter)' }}>
        {TABS.map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
            {t === 'notifications' && summary.unreadNotifications > 0 && <span className="badge new xs" style={{ marginLeft: 6 }}>{summary.unreadNotifications}</span>}
          </button>
        ))}
      </div>

      <div aria-busy={navigating} style={{ opacity: navigating ? .45 : 1, transition: 'opacity .2s', pointerEvents: navigating ? 'none' : undefined }}>
        {data.tab === 'overview' && <Overview data={data} achievements={achievements} />}
        {data.tab === 'bookmarks' && <Bookmarks page={data.page} />}
        {data.tab === 'history' && <History page={data.page} />}
        {data.tab === 'following' && <Following page={data.page} />}
        {data.tab === 'notifications' && <Notifications page={data.page} />}

        {data.tab === 'achievements' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,240px),1fr))', gap: 10, animation: 'fade .25s' }}>
            {achievements.map(([icon, title, desc, p]) => {
              const done = p >= 1;
              return (
                <div key={title} className="card stack" style={{ padding: 18, gap: 10, opacity: done ? 1 : .75 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ width: 44, height: 44, borderRadius: 12, background: done ? 'rgba(232,130,95,.14)' : 'var(--s2)', display: 'grid', placeItems: 'center' }}><Icon name={icon} size={24} color={done ? 'var(--ember)' : 'var(--ink-3)'} /></span>
                    <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{done ? 'UNLOCKED' : `${Math.round(p * 100)}%`}</span>
                  </div>
                  <span style={{ font: '600 15px var(--sans)' }}>{title}</span>
                  <span style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.45 }}>{desc}</span>
                  <Bar pct={p * 100} color={done ? 'var(--ember)' : 'var(--ink-2)'} />
                </div>
              );
            })}
          </div>
        )}

        {data.tab === 'settings' && (
          <div className="stack" style={{ gap: 20, maxWidth: 720, animation: 'fade .25s' }}>
            <form action={saveAction} className="panel stack" style={{ gap: 18 }}>
              <span style={{ font: '400 22px var(--serif)' }}>Account</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 16 }}>
                <label className="field"><span className="label">Display name</span>
                  <input className={`input ${fieldError('displayName') ? 'invalid' : ''}`} name="displayName" required maxLength={64} defaultValue={saved.values?.displayName ?? account.displayName} aria-invalid={!!fieldError('displayName')} />
                  {fieldError('displayName') && <span style={{ fontSize: 13, color: 'var(--danger-text)' }}>{fieldError('displayName')}</span>}
                </label>
                <label className="field"><span className="label">Username</span>
                  <input className={`input mono ${fieldError('username') ? 'invalid' : ''}`} name="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.]{3,32}" defaultValue={saved.values?.username ?? account.username} aria-invalid={!!fieldError('username')} />
                  {fieldError('username') && <span style={{ fontSize: 13, color: 'var(--danger-text)' }}>{fieldError('username')}</span>}
                </label>
                <label className="field" style={{ gridColumn: '1/-1' }}><span className="label">Email</span><input className="input" type="email" value={account.email} readOnly aria-readonly /></label>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Button type="submit" variant="primary" fs={14} loading={saving} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
              </div>
            </form>
            <Preferences account={account} />
            <div className="row" style={{ padding: 'clamp(18px,3vw,28px)', borderRadius: 20, border: '1px solid rgba(229,103,92,.2)', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div className="stack" style={{ gap: 4 }}><span style={{ font: '600 15px var(--sans)' }}>Sign out everywhere</span><span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Ends sessions on all other devices. Progress stays synced.</span></div>
              <Button variant="danger" fs={14} loading={signingOut} disabled={signingOut} onClick={() => startSignOut(async () => {
                const { count } = await logoutOtherDevicesAction();
                site.toast(count ? `Signed out of ${count} other device${count === 1 ? '' : 's'}` : 'No other devices were signed in', 'logout', 'var(--ink-2)');
              })}>Sign out</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Overview */

function Overview({ data, achievements }: { data: Extract<ProfileTabData, { tab: 'overview' }>; achievements: [string, string, string, number][] }) {
  const mounted = useMounted();
  // Chapters read per day for the last 7 days, in the reader's timezone.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const counts = days.map(d => data.recentReads.filter(t => { const x = new Date(t); return x >= d && x.getTime() < d.getTime() + 86_400_000; }).length);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const unlocked = achievements.filter(a => a[3] >= 1);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, animation: 'fade .25s' }}>
      <div className="stack" style={{ gap: 14 }}>
        <span className="kicker">Continue reading</span>
        {data.continueReading.length === 0 && (
          <Empty icon="auto_stories" title="Nothing in progress" text="Chapters you start show up here so you can pick up where you left off."
            action={<Link href="/browse" className="btn btn-primary" style={{ '--h': '40px', '--fs': '14px', color: 'var(--bg)' } as React.CSSProperties}>Find something to read</Link>} />
        )}
        {data.continueReading.map(c => (
          <Link key={c.seriesSlug} href={`/read/${c.seriesSlug}/${chapterNo(c.nextChapter ?? c.chapterNumber)}`} className="card hover-card row" style={{ gap: 14, padding: 10, borderRadius: 14 }}>
            <div style={{ width: 48, flex: 'none', aspectRatio: '3/4', borderRadius: 8, background: coverBg(c.coverHue, c.coverUrl) }} />
            <div className="stack grow" style={{ gap: 6, minWidth: 0 }}>
              <span className="ellipsis" style={{ font: '600 15px var(--sans)' }}>{c.seriesTitle}</span>
              <div className="row" style={{ gap: 10 }}>
                <div className="grow"><Bar pct={c.nextChapter !== null ? 0 : c.percent} /></div>
                <span className="meta" style={{ flex: 'none' }}>{c.nextChapter !== null ? `NEXT · CH. ${chapterNo(c.nextChapter)}` : `CH. ${chapterNo(c.chapterNumber)}`}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="stack" style={{ gap: 14 }}>
        <span className="kicker">This week · {mounted ? `${total} chapter${total === 1 ? '' : 's'}` : '…'}</span>
        <div className="card row" style={{ padding: 20, alignItems: 'flex-end', gap: 10, height: 200 }}>
          {days.map((d, i) => (
            <div key={i} className="stack" style={{ flex: 1, alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }} title={mounted ? `${counts[i]} chapter${counts[i] === 1 ? '' : 's'}` : undefined}>
              <div style={{ width: '100%', maxWidth: 36, height: mounted ? `${Math.max(4, (counts[i] / max) * 100)}%` : '4%', borderRadius: 6, background: i === 6 ? 'var(--ember)' : 'var(--s4)', transition: 'height .4s var(--ease)' }} />
              <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }} suppressHydrationWarning>{mounted ? d.toLocaleDateString('en-US', { weekday: 'narrow' }) : '·'}</span>
            </div>
          ))}
        </div>
        <span className="kicker" style={{ marginTop: 8 }}>Achievements · {unlocked.length}/{achievements.length}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
          {(unlocked.length ? unlocked : achievements).slice(0, 3).map(([icon, title, , p]) => (
            <div key={title} className="card stack" style={{ padding: 14, gap: 8, borderRadius: 14, opacity: p >= 1 ? 1 : .6 }}>
              <Icon name={icon} size={24} color={p >= 1 ? 'var(--ember)' : 'var(--ink-3)'} /><span style={{ font: '600 14px var(--sans)' }}>{title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Bookmarks */

function Bookmarks({ page }: { page: Paged<BookmarkDTO> }) {
  const site = useSite();
  if (page.total === 0) {
    return <Empty icon="bookmarks" title="No bookmarks yet" text="Tap the bookmark on any series to keep it here."
      action={<Link href="/browse" className="btn btn-primary" style={{ '--h': '40px', '--fs': '14px', color: 'var(--bg)' } as React.CSSProperties}>Browse series</Link>} />;
  }
  return (
    <div className="stack" style={{ gap: 24, animation: 'fade .25s' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(130px,14vw,180px),1fr))', gap: '24px 16px' }}>
        {page.items.map(s => {
          const read = s.progressChapter ?? 0;
          const pct = s.latestChapter ? Math.min(100, Math.round((read / s.latestChapter) * 100)) : 0;
          const on = site.bm[s.slug] !== false;
          return (
            <div key={s.slug} className="stack" style={{ gap: 4, position: 'relative', opacity: on ? 1 : .45, transition: 'opacity .2s' }}>
              <Link href={`/series/${s.slug}`} aria-label={s.title} style={{ marginBottom: 6 }}>
                <Cover bg={coverBg(s.coverHue, s.coverUrl)} className="lift" style={{ width: '100%' }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(255,255,255,.15)', zIndex: 1 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ember)' }} />
                  </div>
                </Cover>
              </Link>
              <button type="button" className="bm-fab" aria-label={on ? `Remove ${s.title} from library` : `Add ${s.title} back`} aria-pressed={on} onClick={() => site.toggleBookmark(s.slug, s.title)}>
                <Icon name="bookmark" fill={on} size={18} color={on ? 'var(--ember)' : 'var(--ink-1)'} />
              </button>
              <Link href={`/series/${s.slug}`} style={{ font: '600 14px/1.3 var(--sans)', color: 'var(--ink-1)' }}>{s.title}</Link>
              <span className="meta">{s.progressChapter !== null ? `CH. ${chapterNo(s.progressChapter)} / ${s.latestChapter !== null ? chapterNo(s.latestChapter) : '—'}` : s.latestChapter !== null ? `NOT STARTED · ${chapterNo(s.latestChapter)} CH.` : 'COMING SOON'}</span>
            </div>
          );
        })}
      </div>
      <Pager total={page.total} limit={page.limit} offset={page.offset} path="/profile" params={pageParams('bookmarks')} />
    </div>
  );
}

/* History */

function History({ page }: { page: Paged<HistoryItemDTO> }) {
  const site = useSite();
  const mounted = useMounted();
  const [clearing, startClear] = useTransition();
  if (page.total === 0) {
    return <Empty icon="history" title="No reading history" text="Chapters you open are listed here, newest first."
      action={<Link href="/browse" className="btn btn-primary" style={{ '--h': '40px', '--fs': '14px', color: 'var(--bg)' } as React.CSSProperties}>Start reading</Link>} />;
  }
  if (!mounted) return <ListSkeleton rows={6} />;

  // Group by the reader's local calendar day.
  const dayKey = (d: Date) => new Date(d).toDateString();
  const now = new Date();
  const today = now.toDateString();
  now.setDate(now.getDate() - 1);
  const yesterday = now.toDateString();
  const groups: [string, HistoryItemDTO[]][] = [];
  for (const h of page.items) {
    const k = dayKey(h.lastReadAt);
    const label = k === today ? 'Today' : k === yesterday ? 'Yesterday' : new Date(h.lastReadAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const last = groups[groups.length - 1];
    if (last?.[0] === label) last[1].push(h);
    else groups.push([label, [h]]);
  }
  const clear = () => {
    if (!confirm('Clear your reading history? Your saved positions in each series are kept.')) return;
    startClear(async () => {
      const res = await clearHistoryAction();
      site.toast(res.ok ? 'Reading history cleared' : res.error, res.ok ? 'delete_sweep' : 'error', res.ok ? 'var(--ink-2)' : 'var(--danger)');
    });
  };

  return (
    <div className="stack" style={{ gap: 24, animation: 'fade .25s' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <span className="meta">{page.total} CHAPTER{page.total === 1 ? '' : 'S'}</span>
        <Button variant="ghost" h={32} fs={13} icon="delete_sweep" loading={clearing} onClick={clear}>Clear history</Button>
      </div>
      {groups.map(([day, items]) => (
        <div key={day} className="stack" style={{ gap: 4 }}>
          <span className="kicker" style={{ paddingBottom: 8 }}>{day}</span>
          {items.map(h => (
            <Link key={`${h.seriesSlug}-${h.chapterNumber}`} href={`/read/${h.seriesSlug}/${chapterNo(h.chapterNumber)}`} className="row-btn" style={{ gap: 14, padding: '10px 8px', borderTop: '1px solid rgba(255,255,255,.06)', borderRadius: 8 }}>
              <div style={{ width: 40, flex: 'none', aspectRatio: '3/4', borderRadius: 6, background: coverBg(h.coverHue, h.coverUrl) }} />
              <div className="stack grow" style={{ gap: 3, minWidth: 0 }}>
                <span className="ellipsis" style={{ font: '600 15px var(--sans)' }}>{h.seriesTitle}</span>
                <span className="meta ellipsis">CH. {chapterNo(h.chapterNumber)}{h.chapterTitle ? ` · ${chapterName(h.chapterNumber, h.chapterTitle).toUpperCase()}` : ''} · {new Date(h.lastReadAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {h.completed ? <span className="meta" style={{ color: 'var(--ink-2)' }}>DONE</span> : <Icon name="play_arrow" size={18} color="var(--ink-3)" />}
            </Link>
          ))}
        </div>
      ))}
      <Pager total={page.total} limit={page.limit} offset={page.offset} path="/profile" params={pageParams('history')} />
    </div>
  );
}

/* Following */

function Following({ page }: { page: Paged<FollowDTO> }) {
  const site = useSite();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (page.total === 0) {
    return <Empty icon="notifications" title="Not following anything" text="Follow a series from its page to get an alert when a new chapter is out."
      action={<Link href="/browse" className="btn btn-primary" style={{ '--h': '40px', '--fs': '14px', color: 'var(--bg)' } as React.CSSProperties}>Browse series</Link>} />;
  }
  const update = (s: FollowDTO, following: boolean, notify: boolean) => {
    setBusy(s.slug);
    setFollowAction(s.slug, following, notify)
      .then(res => {
        if (!res.ok) return site.toast(res.error, 'error', 'var(--danger)');
        site.toast(!following ? `Unfollowed ${s.title}` : notify ? `Alerts on for ${s.title}` : `Alerts off for ${s.title}`, notify && following ? 'notifications_active' : 'notifications_off', 'var(--info)');
        router.refresh();
      })
      .catch(() => site.toast('Couldn’t update. Check your connection.', 'error', 'var(--danger)'))
      .finally(() => setBusy(null));
  };
  return (
    <div className="stack" style={{ gap: 24, animation: 'fade .25s' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))', gap: 10 }}>
        {page.items.map(s => (
          <div key={s.slug} className="card row" style={{ gap: 14, padding: 12, borderRadius: 14, opacity: busy === s.slug ? .6 : 1 }}>
            <Link href={`/series/${s.slug}`} aria-label={s.title} style={{ width: 52, flex: 'none', aspectRatio: '3/4', borderRadius: 8, background: coverBg(s.coverHue, s.coverUrl) }} />
            <div className="stack grow" style={{ gap: 3, minWidth: 0 }}>
              <Link href={`/series/${s.slug}`} className="ellipsis" style={{ font: '600 15px var(--sans)', color: 'var(--ink-1)' }}>{s.title}</Link>
              <span className="meta" suppressHydrationWarning>{s.latestChapter !== null ? `CH. ${chapterNo(s.latestChapter)} · ${timeAgo(s.latestChapterAt).toUpperCase()}` : 'NO CHAPTERS YET'}</span>
            </div>
            <IconButton icon={s.notify ? 'notifications_active' : 'notifications_off'} fill={s.notify} label={s.notify ? 'Turn off chapter alerts' : 'Turn on chapter alerts'} aria-pressed={s.notify}
              iconColor={s.notify ? 'var(--ember)' : 'var(--ink-3)'} disabled={busy === s.slug} style={{ border: '1px solid rgba(255,255,255,.1)' }}
              onClick={() => update(s, true, !s.notify)} />
            <IconButton icon="close" label={`Unfollow ${s.title}`} h={36} disabled={busy === s.slug} iconColor="var(--ink-3)" onClick={() => update(s, false, false)} />
          </div>
        ))}
      </div>
      <Pager total={page.total} limit={page.limit} offset={page.offset} path="/profile" params={pageParams('following')} />
    </div>
  );
}

/* Notifications */

const NOTIFICATION_ICON: Record<NotificationDTO['type'], string> = {
  new_chapter: 'auto_stories', payment_confirmed: 'workspace_premium', payment_rejected: 'credit_card_off', report_update: 'flag', system: 'info',
};

function Notifications({ page }: { page: Paged<NotificationDTO> & { unread: number } }) {
  const site = useSite();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (page.total === 0) {
    return <Empty icon="notifications" title="No notifications" text="New chapters from series you follow will show up here." />;
  }
  const markAll = () => start(async () => {
    const res = await markNotificationsReadAction();
    if (!res.ok) site.toast(res.error, 'error', 'var(--danger)');
  });
  const open = (n: NotificationDTO) => {
    if (!n.readAt) markNotificationsReadAction([n.id]).catch(() => {});
    if (n.href) router.push(n.href);
  };
  return (
    <div className="stack" style={{ gap: 16, animation: 'fade .25s', maxWidth: 760 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <span className="meta">{page.unread ? `${page.unread} UNREAD` : 'ALL CAUGHT UP'}</span>
        {page.unread > 0 && <Button variant="ghost" h={32} fs={13} icon="done_all" loading={pending} onClick={markAll}>Mark all as read</Button>}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {page.items.map(n => (
          <li key={n.id} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
            <button type="button" className="row-btn" onClick={() => open(n)} style={{ gap: 14, padding: '14px 8px', alignItems: 'flex-start', background: n.readAt ? undefined : 'rgba(232,130,95,.05)', borderRadius: 8 }}>
              <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 10, background: 'var(--s2)', display: 'grid', placeItems: 'center' }}>
                <Icon name={NOTIFICATION_ICON[n.type]} size={20} color={n.readAt ? 'var(--ink-3)' : 'var(--ember)'} />
              </span>
              <span className="stack grow" style={{ gap: 3, minWidth: 0, textAlign: 'left' }}>
                <span style={{ font: `${n.readAt ? 500 : 600} 15px var(--sans)`, color: n.readAt ? 'var(--ink-2)' : 'var(--ink-1)' }}>{n.title}</span>
                {n.body && <span style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.45 }}>{n.body}</span>}
                <span className="meta" suppressHydrationWarning>{timeAgo(n.createdAt).toUpperCase()}</span>
              </span>
              {!n.readAt && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ember)', marginTop: 8, flex: 'none' }} />}
            </button>
          </li>
        ))}
      </ul>
      <Pager total={page.total} limit={page.limit} offset={page.offset} path="/profile" params={pageParams('notifications')} />
    </div>
  );
}

/* Settings: preferences saved to the account */

function Preferences({ account }: { account: ProfileAccount }) {
  const site = useSite();
  const [prefs, setPrefs] = useState({ emailOnNewChapter: account.emailOnNewChapter, showActivity: account.showActivity });
  const save = (patch: Partial<typeof prefs>) => {
    const prev = prefs;
    setPrefs(p => ({ ...p, ...patch }));
    savePreferencesAction(patch)
      .then(res => { if (!res.ok) { setPrefs(prev); site.toast(res.error, 'error', 'var(--danger)'); } })
      .catch(() => { setPrefs(prev); site.toast('Couldn’t save. Check your connection.', 'error', 'var(--danger)'); });
  };
  return (
    <div className="panel stack" style={{ gap: 6 }}>
      <span style={{ font: '400 22px var(--serif)', marginBottom: 8 }}>Preferences</span>
      <SwitchRow label="New chapter alerts by email" desc="When a series you follow with alerts on updates" on={prefs.emailOnNewChapter}
        style={{ borderTop: '1px solid rgba(255,255,255,.06)' }} onToggle={() => save({ emailOnNewChapter: !prefs.emailOnNewChapter })} />
      <SwitchRow label="Hide reader controls while scrolling" desc="Tap the page to bring them back. Synced to your account." on={site.reader.autoHide}
        style={{ borderTop: '1px solid rgba(255,255,255,.06)' }} onToggle={() => site.setReader({ autoHide: !site.reader.autoHide })} />
      <SwitchRow label="Show reading activity on profile" desc="Let others see what you’re reading" on={prefs.showActivity}
        style={{ borderTop: '1px solid rgba(255,255,255,.06)' }} onToggle={() => save({ showActivity: !prefs.showActivity })} />
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="stack" style={{ gap: 10 }} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row" style={{ gap: 14, padding: '10px 8px' }}>
          <div className="skeleton" style={{ width: 40, aspectRatio: '3/4', borderRadius: 6 }} />
          <div className="stack grow" style={{ gap: 8 }}>
            <div style={{ height: 14, width: '45%', borderRadius: 4, background: 'var(--s2)' }} />
            <div style={{ height: 10, width: '25%', borderRadius: 4, background: 'var(--s2)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
