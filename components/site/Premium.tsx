'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Icon } from '@/components/ui';
import { shortDate, timeAgo } from '@/lib/catalog';
import { startPaymentAction, submitTransferAction } from '@/server/actions/library';
import type { MyPremiumStateDTO } from '@/server/data/billing';
import { useSite } from './store';

export type PlanKey = '1m' | '3m' | '12m';
export type PlanDTO = { key: PlanKey; periodDays: number; amountCents: number; currency: string };
export type BankDTO = { holder: string; bank: string; iban: string; bic: string };

const PERKS = ['Early access to new chapters, before they’re free for everyone', 'Supports the translators and letterers', 'No ads between chapters', 'No auto-renewal. Transfer again to extend.'];
const NAME: Record<PlanKey, string> = { '1m': '1 month', '3m': '3 months', '12m': '12 months' };
const money = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

export default function Premium({ plans, bank, state }: { plans: PlanDTO[]; bank: BankDTO; state: MyPremiumStateDTO | null }) {
  const site = useSite();
  const router = useRouter();
  const signedIn = !!site.viewer;
  const bankConfigured = [bank.holder, bank.bank, bank.iban, bank.bic].every(value => value.trim().length > 0);
  const latest = state?.latest ?? null;
  const pending = latest?.status === 'pending' ? latest : null;
  const active = !!state?.premiumUntil && new Date(state.premiumUntil) > new Date();
  const [planKey, setPlanKey] = useState<PlanKey>(pending?.plan ?? '1m');
  const [ref, setRef] = useState(pending?.submittedReference ?? '');
  const [touched, setTouched] = useState(false);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const monthly = plans.find(p => p.key === '1m')!;
  const plan = plans.find(p => p.key === planKey)!;
  // The reference code belongs to a pending payment for the chosen plan.
  const code = pending && pending.plan === planKey ? pending.referenceCode : null;
  const refOk = ref.trim().length >= 6 && /^[A-Za-z0-9][A-Za-z0-9 ._/#-]*[A-Za-z0-9]$/.test(ref.trim());
  const invalid = (touched && !refOk) || !!fieldErr;
  const submitted = !!pending?.submittedReference && !editing;
  const view: 'info' | 'pending' | 'active' = submitted ? 'pending' : active && !editing && !pending && latest?.status !== 'rejected' ? 'active' : 'info';

  const copy = (label: string, value: string) => {
    try { navigator.clipboard?.writeText(value); } catch {}
    setCopied(label);
    site.toast(`${label} copied`, 'content_copy', 'var(--info)');
    setTimeout(() => setCopied(c => (c === label ? null : c)), 1800);
  };
  const getCode = () => {
    if (!bankConfigured) return site.toast('Bank transfer instructions are not available yet.', 'error', 'var(--danger)');
    if (!signedIn) return site.requireSignIn('Sign in to get your payment reference');
    start(async () => {
      const res = await startPaymentAction(planKey);
      if (!res.ok) return site.toast(res.error, 'error', 'var(--danger)');
      router.refresh();
    });
  };
  const submit = () => {
    if (!bankConfigured) return site.toast('Bank transfer instructions are not available yet.', 'error', 'var(--danger)');
    if (!signedIn) return site.requireSignIn('Sign in to confirm your transfer');
    if (!pending || !code) return site.toast('Get your reference code first (step 1)', 'info', 'var(--info)');
    if (!refOk) return setTouched(true);
    start(async () => {
      const res = await submitTransferAction(pending.id, ref);
      if (!res.ok) { setFieldErr(res.fields?.reference?.[0] ?? res.error); return; }
      setFieldErr(null);
      setEditing(false);
      window.scrollTo(0, 0);
      router.refresh();
    });
  };

  const bankRows: [string, string, 'sans' | 'mono' | 'code', boolean][] = [
    ['Account holder', bank.holder, 'sans', false],
    ['Bank', bank.bank, 'sans', false],
    ['IBAN', bank.iban, 'mono', true],
    ['BIC / SWIFT', bank.bic, 'mono', true],
    ['Amount', money(plan.amountCents, plan.currency), 'mono', true],
  ];

  return (
    <div className="page-anim stack" style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(28px,5vw,72px) var(--gutter) 64px', gap: 'clamp(32px,5vw,56px)' }}>
      {view === 'info' && <>
        <div className="stack" style={{ gap: 16, maxWidth: 720 }}>
          <span className="kicker accent">Nerio Premium</span>
          <h1 style={{ font: '400 clamp(38px,6vw,72px)/1 var(--serif)', letterSpacing: '-.025em', textWrap: 'balance' }}>Read new chapters the day they land.</h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: 560 }}>Premium is paid by bank transfer. Choose a plan, send the amount with your reference code, and we activate your account once the transfer arrives.</p>
          {active && <span className="badge ember" style={{ alignSelf: 'flex-start' }}>PREMIUM ACTIVE UNTIL {shortDate(state!.premiumUntil).toUpperCase()} · TRANSFER AGAIN TO EXTEND</span>}
          {latest?.status === 'rejected' && (
            <div className="row" style={{ gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(229,103,92,.08)', border: '1px solid rgba(229,103,92,.25)', fontSize: 14, color: 'var(--danger-text)', alignItems: 'flex-start' }}>
              <Icon name="error" size={18} /><span>We couldn’t match your transfer with reference {latest.referenceCode}. {latest.notes ?? 'Check the reference code and try again.'}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,400px),1fr))', gap: 'clamp(20px,3vw,32px)', alignItems: 'start' }}>
          <div className="stack" style={{ gap: 20 }}>
            <div role="radiogroup" aria-label="Plan" className="stack" style={{ gap: 10 }}>
              {plans.map(p => {
                const on = planKey === p.key;
                const months = p.periodDays / 30;
                const save = p.key === '1m' ? 0 : Math.round((1 - p.amountCents / (monthly.amountCents * (p.key === '12m' ? 12 : months))) * 100);
                return (
                  <button key={p.key} type="button" role="radio" aria-checked={on} className="plan-option" onClick={() => setPlanKey(p.key)}
                    style={{ borderColor: on ? 'var(--ember)' : undefined, background: on ? 'rgba(232,130,95,.06)' : undefined }}>
                    <span style={{ width: 20, height: 20, flex: 'none', borderRadius: '50%', border: `2px solid ${on ? 'var(--ember)' : 'var(--ink-5)'}`, display: 'grid', placeItems: 'center' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: on ? 'var(--ember)' : 'transparent' }} />
                    </span>
                    <span className="stack grow" style={{ gap: 2 }}><span style={{ font: '600 16px var(--sans)' }}>{NAME[p.key]}</span><span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{p.periodDays} days of Premium</span></span>
                    {save > 0 && <span className="badge success xs">SAVE {save}%</span>}
                    <span style={{ font: '500 18px var(--mono)', letterSpacing: '-.02em' }}>{money(p.amountCents, p.currency)}</span>
                  </button>
                );
              })}
            </div>
            <ul className="card stack" style={{ listStyle: 'none', margin: 0, padding: 20, gap: 12 }}>
              {PERKS.map(p => <li key={p} className="row" style={{ gap: 12, fontSize: 15, color: 'var(--ink-soft)', alignItems: 'flex-start' }}><Icon name="check" color="var(--success)" />{p}</li>)}
            </ul>
          </div>
          <div className="panel stack" style={{ gap: 20, borderColor: 'rgba(255,255,255,.08)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ font: '400 24px var(--serif)' }}>Bank transfer details</span><span style={{ font: '500 12px var(--mono)', color: 'var(--ink-3)' }}>STEP 1 OF 2</span>
            </div>
            {!bankConfigured && <div role="status" className="row" style={{ gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(230,194,106,.08)', border: '1px solid rgba(230,194,106,.2)', fontSize: 13, color: 'var(--warning-text)' }}><Icon name="info" size={18} />Bank transfer is not set up yet. Please check back later.</div>}
            <div className="stack">
              {bankRows.map(([label, value, kind, copyable]) => (
                <div key={label} className="row" style={{ gap: 12, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                  <div className="stack grow" style={{ gap: 3 }}>
                    <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>{label.toUpperCase()}</span>
                    <span style={{ font: `500 15px var(${kind === 'mono' ? '--mono' : '--sans'})`, color: value ? 'var(--ink-1)' : 'var(--ink-3)', wordBreak: 'break-all' }}>{value || 'Not configured'}</span>
                  </div>
                  {copyable && (
                    <Button variant="secondary" h={36} px={10} fs={12} icon={copied === label ? 'check' : 'content_copy'} aria-label={`Copy ${label}`}
                      onClick={() => copy(label, label === 'IBAN' ? value.replace(/\s/g, '') : label === 'Amount' ? (plan.amountCents / 100).toFixed(2) : value)}>{copied === label ? 'Copied' : 'Copy'}</Button>
                  )}
                </div>
              ))}
              <div className="row" style={{ gap: 12, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <div className="stack grow" style={{ gap: 3 }}>
                  <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>REFERENCE CODE</span>
                  {code ? <span style={{ font: '500 18px var(--mono)', color: 'var(--ember-text)' }}>{code}</span> : <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>Personal code for this plan, so we can match your transfer.</span>}
                </div>
                {code
                  ? <Button variant="secondary" h={36} px={10} fs={12} icon={copied === 'Reference code' ? 'check' : 'content_copy'} aria-label="Copy reference code" onClick={() => copy('Reference code', code)}>{copied === 'Reference code' ? 'Copied' : 'Copy'}</Button>
                  : <Button variant="accent" h={36} px={12} fs={13} disabled={!bankConfigured} loading={busy} onClick={getCode}>{signedIn ? 'Get code' : 'Sign in'}</Button>}
              </div>
            </div>
            <div className="row" style={{ gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(230,194,106,.08)', border: '1px solid rgba(230,194,106,.2)', fontSize: 13, lineHeight: 1.5, color: 'var(--warning-text)', alignItems: 'flex-start' }}>
              <Icon name="info" size={18} /><span>Put the reference code in the transfer description so we can match your payment.</span>
            </div>
            <div style={{ height: 1, background: 'var(--line-1)' }} />
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ font: '400 24px var(--serif)' }}>Confirm transfer</span><span style={{ font: '500 12px var(--mono)', color: 'var(--ink-3)' }}>STEP 2 OF 2</span>
            </div>
            <label className="field">
              <span className="label">Bank transaction reference</span>
              <input className={`input mono ${invalid ? 'invalid' : ''}`} style={{ '--h': '48px' } as React.CSSProperties} value={ref} maxLength={128} disabled={!code}
                onChange={e => { setRef(e.target.value); setFieldErr(null); }} placeholder="e.g. 2026100388213" aria-invalid={invalid} />
              <span style={{ fontSize: 13, color: invalid ? 'var(--danger-text)' : 'var(--ink-3)' }}>
                {fieldErr ?? (invalid ? 'Enter the reference from your bank receipt (at least 6 characters).' : code ? 'Found on your banking app’s receipt after the transfer.' : 'Get your reference code in step 1 first.')}
              </span>
            </label>
            <Button variant="primary" h={52} loading={busy && !!code} disabled={busy || !code} onClick={submit}>{busy && code ? 'Submitting' : 'I have transferred'}</Button>
          </div>
        </div>
      </>}

      {view === 'pending' && pending && (
        <div className="stack" style={{ maxWidth: 620, margin: '0 auto', width: '100%', gap: 24, alignItems: 'center', textAlign: 'center', animation: 'pop .3s var(--ease)' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(230,194,106,.12)', display: 'grid', placeItems: 'center' }}>
            <Icon name="schedule" size={34} color="var(--warning)" style={{ animation: 'pulse 2s ease-in-out infinite' }} />
          </div>
          <h1 style={{ font: '400 clamp(32px,5vw,52px)/1.05 var(--serif)', letterSpacing: '-.02em' }}>We’re checking your transfer</h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: 460 }}>Bank transfers usually arrive within one business day. You’ll get a notification as soon as Premium is active.</p>
          <div className="panel stack" style={{ width: '100%', padding: 20, textAlign: 'left', borderColor: 'rgba(255,255,255,.08)' }}>
            <div className="row" style={{ gap: 14, padding: '12px 0' }}>
              <Icon name="check_circle" fill color="var(--success)" />
              <div className="stack" style={{ gap: 2 }}><span style={{ font: '600 15px var(--sans)' }}>Transfer submitted</span><span className="meta" suppressHydrationWarning>REF {pending.submittedReference} · {timeAgo(pending.createdAt).toUpperCase()}</span></div>
            </div>
            <div className="row" style={{ gap: 14, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
              <span className="spinner" style={{ width: 20, height: 20, borderTopColor: 'var(--warning)', animationDuration: '1s' }} />
              <div className="stack" style={{ gap: 2 }}><span style={{ font: '600 15px var(--sans)' }}>Matching payment</span><span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{NAME[pending.plan]} · {money(pending.amountCents, pending.currency)} · code {pending.referenceCode}</span></div>
            </div>
            <div className="row" style={{ gap: 14, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)', opacity: .5 }}>
              <Icon name="radio_button_unchecked" color="var(--ink-3)" /><span style={{ font: '600 15px var(--sans)' }}>Premium activated</span>
            </div>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button variant="secondary" fs={14} onClick={() => router.push('/')}>Keep reading free chapters</Button>
            <Button variant="ghost" fs={14} onClick={() => { setEditing(true); setPlanKey(pending.plan); }}>Edit reference</Button>
          </div>
        </div>
      )}

      {view === 'active' && (
        <div className="stack" style={{ maxWidth: 620, margin: '0 auto', width: '100%', gap: 24, alignItems: 'center', textAlign: 'center', animation: 'pop .3s var(--ease)' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(123,201,160,.12)', display: 'grid', placeItems: 'center' }}><Icon name="verified" fill size={36} color="var(--success)" /></div>
          <h1 style={{ font: '400 clamp(32px,5vw,52px)/1.05 var(--serif)', letterSpacing: '-.02em' }}>Premium is active</h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)' }}>Your access runs until {shortDate(state!.premiumUntil)}. There’s no auto-renewal.</p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link href="/browse?sort=updated" className="btn btn-primary" style={{ '--h': '44px', '--fs': '14px', color: 'var(--bg)' } as React.CSSProperties}>Read the latest chapters</Link>
            <Button variant="ghost" fs={14} onClick={() => setEditing(true)}>Extend Premium</Button>
          </div>
        </div>
      )}
    </div>
  );
}
