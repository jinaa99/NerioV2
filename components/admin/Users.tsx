'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, useTransition } from 'react';
import Pager from '@/components/Pager';
import { Button, Icon, Segmented, SwitchRow } from '@/components/ui';
import { shortDate, timeAgo } from '@/lib/catalog';
import { confirmPaymentAction, rejectPaymentAction, setUserRoleAction, setUserStatusAction } from '@/server/actions/admin';
import type { AdminUserDTO, UserFilter } from '@/server/data/account';
import type { AdminPaymentDTO } from '@/server/data/billing';
import { useAdmin } from './store';

type Paged<T> = { items: T[]; total: number; limit: number; offset: number };
type PayStatus = 'pending' | 'confirmed' | 'rejected';
type Props =
  | { tab: 'users'; users: Paged<AdminUserDTO>; q: string; filter: UserFilter; pendingPayments: number; currentUserId: string }
  | { tab: 'payments'; payments: Paged<AdminPaymentDTO>; payStatus: PayStatus; pendingPayments: number; currentUserId: string };

const ROLE_INFO: [('translator' | 'editor' | 'admin'), string][] = [
  ['translator', 'Review and edit translations'],
  ['editor', 'Manage series, chapters, the pipeline and reports'],
  ['admin', 'Everything, including users, payments, settings and the audit log'],
];
const tone = (seed: string) => `oklch(.4 .06 ${[...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)})`;
const money = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
const PLAN_LABEL = { '1m': '1 MONTH', '3m': '3 MONTHS', '12m': '12 MONTHS' } as const;

function Col({ label, children, min, color }: { label: string; children: React.ReactNode; min: number; color?: string }) {
  return (
    <div className="stack" style={{ gap: 2, minWidth: min }}>
      <span style={{ font: '400 10px var(--mono)', color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ font: '500 13px var(--mono)', color }}>{children}</span>
    </div>
  );
}

export default function Users(props: Props) {
  const router = useRouter();
  const path = usePathname();
  const [navigating, startNav] = useTransition();
  const go = (qs: string) => startNav(() => router.replace(qs ? `${path}?${qs}` : path));

  return (
    <div className="stack" style={{ gap: 16, opacity: navigating ? .6 : 1, transition: 'opacity .2s' }}>
      <div role="tablist" className="tabs" style={{ gap: 24 }}>
        {(['All users', 'Payments'] as const).map((label, i) => (
          <button key={label} type="button" role="tab" aria-selected={(props.tab === 'payments') === (i === 1)} style={{ fontSize: 14, paddingBottom: 12 }} onClick={() => go(i ? 'tab=payments' : '')}>
            {label}
            {i === 1 && props.pendingPayments > 0 && <span style={{ font: '500 11px var(--mono)', padding: '1px 6px', borderRadius: 999, background: 'rgba(232,130,95,.16)', color: 'var(--ember-text)' }}>{props.pendingPayments}</span>}
          </button>
        ))}
      </div>
      {props.tab === 'users' ? <UserList {...props} go={go} /> : <Payments {...props} go={go} />}
    </div>
  );
}

/* Users */

function UserList({ users, q, filter, currentUserId, go }: Extract<Props, { tab: 'users' }> & { go: (qs: string) => void }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const path = usePathname();
  const [query, setQuery] = useState(q);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const qs = (next: { q?: string; filter?: string }) => {
    const sp = new URLSearchParams();
    const nq = (next.q ?? query).trim(), nf = next.filter ?? filter;
    if (nq) sp.set('q', nq);
    if (nf !== 'all') sp.set('filter', nf);
    return sp.toString();
  };
  useEffect(() => {
    if (query === q) return;
    const t = setTimeout(() => go(qs({ q: query })), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typing triggers the search
  }, [query]);

  const act = (u: AdminUserDTO, key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(`${u.id}:${key}`);
    start(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) return toast(res.error ?? 'Something went wrong', 'error', 'var(--danger)');
      toast(done, 'check_circle', 'var(--success)');
      router.refresh();
    });
  };

  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="searchbox" style={{ flex: '1 1 240px', maxWidth: 360, '--h': '36px', borderRadius: 9, padding: '0 10px' } as React.CSSProperties}>
          <Icon name="search" size={18} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, username or email" aria-label="Search users" style={{ fontSize: 13 }} />
        </label>
        <Segmented h={30} options={[['all', 'All'], ['staff', 'Staff'], ['premium', 'Premium'], ['suspended', 'Suspended']]} value={filter} onChange={v => go(qs({ filter: v }))} />
        <span className="meta" style={{ marginLeft: 'auto' }}>{users.total} USERS</span>
      </div>
      <div className="a-table-wrap">
        <table className="a-table" style={{ minWidth: 860 }}>
          <thead><tr><th>USER</th><th>ROLES</th><th>PLAN</th><th style={{ textAlign: 'right' }}>CHAPTERS</th><th>LAST ACTIVE</th><th>JOINED</th><th /></tr></thead>
          <tbody>
            {users.items.map(u => {
              const name = u.displayName ?? u.email;
              const premium = !!u.premiumUntil && new Date(u.premiumUntil) > new Date();
              const staffRoles = u.roles.filter(r => r !== 'reader');
              const self = u.id === currentUserId;
              return (
                <Fragment key={u.id}>
                  <tr style={{ opacity: u.status === 'suspended' ? .6 : 1 }}>
                    <td><div className="row" style={{ gap: 10 }}>
                      <span style={{ width: 28, height: 28, flex: 'none', borderRadius: '50%', background: tone(u.id), display: 'grid', placeItems: 'center', font: '600 12px var(--sans)' }}>{name[0]?.toUpperCase()}</span>
                      <div className="stack" style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{name}{self && <span className="meta" style={{ marginLeft: 6 }}>YOU</span>}</span>
                        <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{u.username ? `@${u.username} · ` : ''}{u.email}</span>
                      </div>
                    </div></td>
                    <td><div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {u.status === 'suspended' && <span className="badge xs danger">SUSPENDED</span>}
                      {staffRoles.length ? staffRoles.map(r => <span key={r} className={`badge xs ${r === 'admin' ? 'ember' : 'info'}`}>{r.toUpperCase()}</span>) : <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>Reader</span>}
                    </div></td>
                    <td>
                      {premium ? <span className="badge xs ember" title={`Until ${shortDate(u.premiumUntil)}`}>PREMIUM</span>
                        : u.pendingPayments ? <span className="badge xs warning">PENDING</span>
                        : <span className="badge xs neutral">FREE</span>}
                    </td>
                    <td className="num">{u.chaptersRead.toLocaleString('en-US')}</td>
                    <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-2)' }} suppressHydrationWarning>{u.lastActiveAt ? timeAgo(u.lastActiveAt) : '—'}</td>
                    <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-3)' }}>{shortDate(u.createdAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn btn-outline" aria-expanded={open === u.id} onClick={() => setOpen(o => (o === u.id ? null : u.id))}
                        style={{ '--h': '30px', '--px': '10px', '--r': '7px', '--fs': '12px', borderColor: 'rgba(255,255,255,.1)' } as React.CSSProperties}>Manage</button>
                    </td>
                  </tr>
                  {open === u.id && (
                    <tr>
                      <td colSpan={7} style={{ background: 'rgba(255,255,255,.02)', padding: '4px 16px 16px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 16 }}>
                          <div className="stack" style={{ gap: 2 }}>
                            <span className="meta" style={{ padding: '8px 0' }}>ROLES</span>
                            {ROLE_INFO.map(([role, desc]) => {
                              const has = u.roles.includes(role);
                              const disabled = busy !== null || (self && role === 'admin');
                              return (
                                <SwitchRow key={role} small label={role[0].toUpperCase() + role.slice(1)} desc={self && role === 'admin' ? 'You can’t remove your own admin role' : desc} on={has}
                                  style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '10px 0', opacity: disabled ? .5 : 1, pointerEvents: disabled ? 'none' : undefined }}
                                  onToggle={() => {
                                    if (role === 'admin' && !has && !confirm(`Give ${name} full admin access?`)) return;
                                    act(u, role, () => setUserRoleAction(u.id, role, !has), `${has ? 'Removed' : 'Granted'} ${role} ${has ? 'from' : 'to'} ${name}`);
                                  }} />
                              );
                            })}
                          </div>
                          <div className="stack" style={{ gap: 10 }}>
                            <span className="meta" style={{ padding: '8px 0 0' }}>ACCOUNT</span>
                            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                              {u.status === 'suspended' ? 'Suspended accounts can’t sign in.' : 'Suspending signs the user out on every device and blocks sign-in.'}
                              {premium && ` Premium until ${shortDate(u.premiumUntil)}.`}
                            </span>
                            <div>
                              {u.status === 'suspended'
                                ? <Button variant="secondary" h={34} icon="lock_open" disabled={busy !== null} loading={busy === `${u.id}:status`} onClick={() => act(u, 'status', () => setUserStatusAction(u.id, 'active'), `${name} reactivated`)}>Reactivate</Button>
                                : <Button variant="danger" h={34} icon="block" disabled={busy !== null || self} loading={busy === `${u.id}:status`}
                                    onClick={() => { if (confirm(`Suspend ${name}? They’ll be signed out everywhere.`)) act(u, 'status', () => setUserStatusAction(u.id, 'suspended'), `${name} suspended`); }}>Suspend</Button>}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {users.items.length === 0 && <div className="stack" style={{ padding: 40, alignItems: 'center', gap: 6, color: 'var(--ink-3)' }}><Icon name="person_search" size={26} />No users match.</div>}
      </div>
      <Pager total={users.total} limit={users.limit} offset={users.offset} path={path} params={{ q: q || undefined, filter: filter === 'all' ? undefined : filter }} />
    </>
  );
}

/* Payments */

function Payments({ payments, payStatus, go }: Extract<Props, { tab: 'payments' }> & { go: (qs: string) => void }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const path = usePathname();
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  const confirmPay = (p: AdminPaymentDTO) => {
    const ref = (refs[p.id] ?? '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._/#-]*[A-Za-z0-9]$/.test(ref) || ref.length < 6) return toast('Enter a valid bank transaction reference (at least 6 characters)', 'error', 'var(--danger)');
    setBusy(p.id);
    start(async () => {
      const res = await confirmPaymentAction(p.id, ref);
      setBusy(null);
      if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
      toast(`Premium activated for ${p.displayName ?? p.email}`);
      router.refresh();
    });
  };
  const reject = (p: AdminPaymentDTO) => {
    const note = prompt('Message to the reader (optional)', `No transfer with reference ${p.referenceCode} has arrived yet.`);
    if (note === null) return;
    setBusy(p.id);
    start(async () => {
      const res = await rejectPaymentAction(p.id, note);
      setBusy(null);
      if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
      toast(`${p.displayName ?? p.email} notified: transfer not found`, 'mail', 'var(--warning)');
      router.refresh();
    });
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Segmented h={30} options={[['pending', 'Pending'], ['confirmed', 'Approved'], ['rejected', 'Rejected']]} value={payStatus} onChange={v => go(v === 'pending' ? 'tab=payments' : `tab=payments&status=${v}`)} />
        <span className="meta" style={{ marginLeft: 'auto' }}>{payments.total} PAYMENTS</span>
      </div>
      {payStatus === 'pending' && <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Match each claim against your bank statement using the reference code, enter the bank’s transaction reference, then confirm to activate Premium.</span>}
      {payments.items.length === 0 && (
        <div className="a-card stack" style={{ padding: 40, alignItems: 'center', gap: 8, color: 'var(--ink-3)' }}>
          <Icon name="payments" size={26} />{payStatus === 'pending' ? 'No transfers waiting for confirmation.' : 'Nothing here yet.'}
        </div>
      )}
      {payments.items.map(p => {
        const name = p.displayName ?? p.email;
        return (
          <div key={p.id} className="a-card row" style={{ gap: 14, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 14, opacity: busy === p.id ? .6 : 1 }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', background: tone(p.userId), display: 'grid', placeItems: 'center', font: '600 13px var(--sans)', flex: 'none' }}>{name[0]?.toUpperCase()}</span>
            <div className="stack" style={{ flex: '1 1 160px', gap: 2, minWidth: 0 }}>
              <span className="ellipsis" style={{ font: '600 14px var(--sans)' }}>{name}</span>
              <span className="ellipsis" style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }} suppressHydrationWarning>{p.email} · {timeAgo(p.createdAt).toUpperCase()}</span>
            </div>
            <Col label="CODE" min={120} color="var(--ember-text)">{p.referenceCode}</Col>
            <Col label="USER REF" min={130}>{p.submittedReference ?? 'Not submitted'}</Col>
            {p.status === 'pending'
              ? <label className="stack" style={{ gap: 2, minWidth: 150 }}>
                  <span style={{ font: '400 10px var(--mono)', color: 'var(--ink-3)' }}>BANK REF</span>
                  <input className="a-input mono" value={refs[p.id] ?? ''} maxLength={128} placeholder="From statement" aria-label={`Bank reference for ${p.referenceCode}`}
                    onChange={e => setRefs(r => ({ ...r, [p.id]: e.target.value }))} style={{ height: 30, fontSize: 12 }} />
                </label>
              : <Col label="BANK REF" min={130}>{p.externalReference ?? '—'}</Col>}
            <Col label={PLAN_LABEL[p.plan]} min={80}><span style={{ fontSize: 14 }}>{money(p.amountCents, p.currency)}</span></Col>
            {p.status === 'pending' ? (
              <div className="row" style={{ gap: 6 }}>
                <Button variant="outline" h={34} px={12} disabled={busy !== null} style={{ color: 'var(--ink-2)' }} onClick={() => reject(p)}>Not received</Button>
                <Button variant="primary" h={34} px={12} disabled={busy !== null} loading={busy === p.id} onClick={() => confirmPay(p)}>Confirm</Button>
              </div>
            ) : (
              <span className={`badge xs ${p.status === 'confirmed' ? 'success' : 'danger'}`} style={{ padding: '4px 8px', borderRadius: 6 }} title={p.notes ?? undefined}>
                {p.status === 'confirmed' ? `APPROVED · UNTIL ${shortDate(p.periodEnd).toUpperCase()}` : 'REJECTED'}
              </span>
            )}
          </div>
        );
      })}
      <Pager total={payments.total} limit={payments.limit} offset={payments.offset} path={path} params={{ tab: 'payments', status: payStatus === 'pending' ? undefined : payStatus }} />
    </div>
  );
}
