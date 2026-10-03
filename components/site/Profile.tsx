'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useTransition } from 'react';
import { Bar, Button, Cover, Icon, IconButton, SwitchRow } from '@/components/ui';
import { CONTINUE, SERIES, cover, freeLatest, getSeries } from '@/lib/data';
import { logoutOtherDevicesAction, updateAccountAction, type FormState } from '@/server/actions/auth';
import { useSite } from './store';

const TABS = ['overview', 'bookmarks', 'history', 'following', 'achievements', 'settings'] as const;
type Tab = (typeof TABS)[number];
const STATS: [string, string][] = [['1,284', 'Chapters read'], ['212 h', 'Reading time'], ['23 days', 'Current streak'], ['38', 'Series started']];
const WEEK: [string, number][] = [['M', 40], ['T', 72], ['W', 30], ['T', 88], ['F', 55], ['S', 100], ['S', 64]];
const HISTORY: [string, [string, number, string, string][]][] = [
  ['Today', [['lantern', 111, '14:02', '40%'], ['lantern', 110, '13:41', 'DONE'], ['ninth', 77, '08:15', '35%']]],
  ['Yesterday', [['orchard', 31, '22:48', '64%'], ['orchard', 30, '22:20', 'DONE'], ['glass', 22, '19:03', '80%']]],
];
const PREF_LABELS: [string, string][] = [
  ['New chapter alerts', 'Email when a followed series updates'],
  ['Hide reader controls while scrolling', 'Tap the page to bring them back'],
  ['Data saver on mobile data', 'Load 720px pages when not on Wi‑Fi'],
  ['Show reading activity on profile', 'Visible to people you follow'],
];

type Account = { email: string; displayName: string; username: string };

export default function Profile({ account }: { account: Account }) {
  const site = useSite();
  const router = useRouter();
  const param = useSearchParams().get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(param ?? '') ? (param as Tab) : 'overview';
  const setTab = (t: Tab) => router.replace(t === 'overview' ? '/profile' : `/profile?tab=${t}`, { scroll: false });
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

  const achievements: [string, string, string, number][] = [
    ['local_fire_department', 'Night owl', 'Read after midnight 10 times', 1], ['auto_stories', 'Bookworm', 'Read 1,000 chapters', 1], ['calendar_month', '3-week streak', 'Read every day for 21 days', 1],
    ['explore', 'Genre hopper', 'Read 8 different genres', .75], ['check_circle', 'Finisher', 'Complete 5 series', .6], ['bolt', 'Day one', 'Read 20 chapters on release day', .45],
    ['forum', 'Voice', 'Leave 50 comments', .2], ['workspace_premium', 'Patron', 'Support Nerio with Premium', site.premium ? 1 : 0],
  ];
  const bookmarks = SERIES.filter(s => site.bm[s.id]);
  const following = SERIES.filter(s => site.follow[s.id] !== undefined);

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
        {STATS.map(([v, l]) => (
          <div key={l} className="card stack" style={{ padding: 18, gap: 6 }}>
            <span style={{ font: '500 clamp(24px,3vw,32px)/1 var(--mono)', letterSpacing: '-.03em' }}>{v}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{l}</span>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Profile sections" className="tabs" style={{ margin: '0 calc(-1 * var(--gutter))', padding: '0 var(--gutter)' }}>
        {TABS.map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, animation: 'fade .25s' }}>
          <div className="stack" style={{ gap: 14 }}>
            <span className="kicker">Continue reading</span>
            {CONTINUE.slice(0, 3).map(([id, ch, pct]) => {
              const s = getSeries(id)!;
              return (
                <Link key={id} href={`/read/${id}/${ch}`} className="card hover-card row" style={{ gap: 14, padding: 10, borderRadius: 14 }}>
                  <div style={{ width: 48, flex: 'none', aspectRatio: '3/4', borderRadius: 8, background: cover(s.hue) }} />
                  <div className="stack grow" style={{ gap: 6 }}>
                    <span style={{ font: '600 15px var(--sans)' }}>{s.title}</span>
                    <div className="row" style={{ gap: 10 }}><div className="grow"><Bar pct={pct} /></div><span className="meta" style={{ flex: 'none' }}>CH. {ch}</span></div>
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="stack" style={{ gap: 14 }}>
            <span className="kicker">This week · 9.4 hours</span>
            <div className="card row" style={{ padding: 20, alignItems: 'flex-end', gap: 10, height: 200 }}>
              {WEEK.map(([d, v], i) => (
                <div key={i} className="stack" style={{ flex: 1, alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ width: '100%', maxWidth: 36, height: `${v}%`, borderRadius: 6, background: i === 5 ? 'var(--ember)' : 'var(--s4)' }} />
                  <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{d}</span>
                </div>
              ))}
            </div>
            <span className="kicker" style={{ marginTop: 8 }}>Recent achievements</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
              {achievements.slice(0, 3).map(([icon, name]) => (
                <div key={name} className="card stack" style={{ padding: 14, gap: 8, borderRadius: 14 }}>
                  <Icon name={icon} size={24} color="var(--ember)" /><span style={{ font: '600 14px var(--sans)' }}>{name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'bookmarks' && (
        <div className="stack" style={{ gap: 16, animation: 'fade .25s' }}>
          {bookmarks.length === 0 && (
            <div className="empty" style={{ padding: '56px 16px' }}>
              <Icon name="bookmarks" size={34} />
              <span style={{ font: '400 24px var(--serif)' }}>No bookmarks yet</span>
              <span style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 280, lineHeight: 1.5 }}>Tap the bookmark on any series to keep it here.</span>
              <Button variant="primary" fs={14} style={{ marginTop: 8 }} onClick={() => router.push('/')}>Browse trending</Button>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(clamp(130px,14vw,180px),1fr))', gap: '24px 16px' }}>
            {bookmarks.map(s => {
              const read = s.progress ? s.progress - 1 : 0;
              return (
                <div key={s.id} className="stack" style={{ gap: 4, position: 'relative' }}>
                  <Link href={`/series/${s.id}`} aria-label={s.title} style={{ marginBottom: 6 }}>
                    <Cover bg={cover(s.hue)} className="lift" style={{ width: '100%' }}>
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(255,255,255,.15)', zIndex: 1 }}>
                        <div style={{ width: `${Math.round((read / s.ch) * 100)}%`, height: '100%', background: 'var(--ember)' }} />
                      </div>
                    </Cover>
                  </Link>
                  <button type="button" className="bm-fab" aria-label="Remove bookmark" onClick={() => site.toggleBookmark(s.id)}><Icon name="bookmark" fill size={18} color="var(--ember)" /></button>
                  <span style={{ font: '600 14px/1.3 var(--sans)' }}>{s.title}</span>
                  <span className="meta">{read} / {s.ch} READ</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="stack" style={{ gap: 24, animation: 'fade .25s' }}>
          {HISTORY.map(([day, items]) => (
            <div key={day} className="stack" style={{ gap: 4 }}>
              <span className="kicker" style={{ paddingBottom: 8 }}>{day}</span>
              {items.map(([id, ch, time, done]) => {
                const s = getSeries(id)!;
                return (
                  <Link key={`${id}-${ch}`} href={`/read/${id}/${ch}`} className="row-btn" style={{ gap: 14, padding: '10px 8px', borderTop: '1px solid rgba(255,255,255,.06)', borderRadius: 8 }}>
                    <div style={{ width: 40, flex: 'none', aspectRatio: '3/4', borderRadius: 6, background: cover(s.hue) }} />
                    <div className="stack grow" style={{ gap: 3 }}><span style={{ font: '600 15px var(--sans)' }}>{s.title}</span><span className="meta">CH. {ch} · {time}</span></div>
                    <span className="meta" style={{ color: 'var(--ink-2)' }}>{done}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {tab === 'following' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))', gap: 10, animation: 'fade .25s' }}>
          {following.map(s => {
            const n = !!site.follow[s.id];
            return (
              <div key={s.id} className="card row" style={{ gap: 14, padding: 12, borderRadius: 14 }}>
                <Link href={`/series/${s.id}`} aria-label={s.title} style={{ width: 52, flex: 'none', aspectRatio: '3/4', borderRadius: 8, background: cover(s.hue) }} />
                <div className="stack grow" style={{ gap: 3 }}><span style={{ font: '600 15px var(--sans)' }}>{s.title}</span><span className="meta">CH. {freeLatest(s)} · {s.when}</span></div>
                <IconButton icon={n ? 'notifications_active' : 'notifications_off'} fill={n} label="Chapter notifications" aria-pressed={n} iconColor={n ? 'var(--ember)' : 'var(--ink-3)'}
                  style={{ border: '1px solid rgba(255,255,255,.1)' }}
                  onClick={() => {
                    site.set(x => ({ follow: { ...x.follow, [s.id]: !n } }));
                    site.toast(n ? `Alerts off for ${s.title}` : `Alerts on for ${s.title}`, n ? 'notifications_off' : 'notifications_active', 'var(--info)');
                  }} />
              </div>
            );
          })}
        </div>
      )}

      {tab === 'achievements' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,240px),1fr))', gap: 10, animation: 'fade .25s' }}>
          {achievements.map(([icon, name, desc, p]) => {
            const done = p === 1;
            return (
              <div key={name} className="card stack" style={{ padding: 18, gap: 10, opacity: done ? 1 : .75 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ width: 44, height: 44, borderRadius: 12, background: done ? 'rgba(232,130,95,.14)' : 'var(--s2)', display: 'grid', placeItems: 'center' }}><Icon name={icon} size={24} color={done ? 'var(--ember)' : 'var(--ink-3)'} /></span>
                  <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{done ? 'UNLOCKED' : `${Math.round(p * 100)}%`}</span>
                </div>
                <span style={{ font: '600 15px var(--sans)' }}>{name}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.45 }}>{desc}</span>
                <Bar pct={p * 100} color={done ? 'var(--ember)' : 'var(--ink-2)'} />
              </div>
            );
          })}
        </div>
      )}

      {tab === 'settings' && (
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
          <div className="panel stack" style={{ gap: 6 }}>
            <span style={{ font: '400 22px var(--serif)', marginBottom: 8 }}>Preferences</span>
            {PREF_LABELS.map(([label, desc], i) => (
              <SwitchRow key={label} label={label} desc={desc} on={site.prefs[i]} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}
                onToggle={() => site.set(x => ({ prefs: x.prefs.map((p, k) => (k === i ? !p : p)) }))} />
            ))}
          </div>
          <div className="row" style={{ padding: 'clamp(18px,3vw,28px)', borderRadius: 20, border: '1px solid rgba(229,103,92,.2)', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 4 }}><span style={{ font: '600 15px var(--sans)' }}>Sign out everywhere</span><span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Ends sessions on all devices. Progress stays synced.</span></div>
            <Button variant="danger" fs={14} loading={signingOut} disabled={signingOut} onClick={() => startSignOut(async () => {
              const { count } = await logoutOtherDevicesAction();
              site.toast(count ? `Signed out of ${count} other device${count === 1 ? '' : 's'}` : 'No other devices were signed in', 'logout', 'var(--ink-2)');
            })}>Sign out</Button>
          </div>
        </div>
      )}
    </div>
  );
}
