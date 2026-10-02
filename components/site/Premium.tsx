'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Icon } from '@/components/ui';
import { BANK, PLANS, SERIES, cover } from '@/lib/data';
import { useSite } from './store';

const PERKS = ['Early access to new chapters, up to 2 ahead', 'Full-resolution pages (1600px)', 'No ads between chapters', 'No auto-renewal. Transfer again to extend.'];

export default function Premium() {
  const site = useSite();
  const router = useRouter();
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const plan = PLANS[site.plan];
  const refOk = site.payRef.trim().length >= 6;
  const invalid = touched && !refOk;

  const copy = (label: string, value: string) => {
    try { navigator.clipboard?.writeText(value); } catch {}
    setCopied(label);
    site.toast(`${label} copied`, 'content_copy', 'var(--info)');
    setTimeout(() => setCopied(c => (c === label ? null : c)), 1800);
  };
  const submit = () => {
    if (!refOk) return setTouched(true);
    setSubmitting(true);
    setTimeout(() => { setSubmitting(false); site.set({ pay: 'pending' }); window.scrollTo(0, 0); }, 900);
  };

  const bankRows: [string, string, 'sans' | 'mono' | 'code', boolean][] = [
    ['Account holder', BANK.holder, 'sans', false],
    ['Bank', BANK.bank, 'sans', false],
    ['IBAN', BANK.iban, 'mono', true],
    ['BIC / SWIFT', BANK.bic, 'mono', true],
    ['Amount', plan.price, 'mono', true],
    ['Reference code', BANK.code, 'code', true],
  ];

  return (
    <div className="page-anim stack" style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(28px,5vw,72px) var(--gutter) 64px', gap: 'clamp(32px,5vw,56px)' }}>
      {site.pay === 'info' && <>
        <div className="stack" style={{ gap: 16, maxWidth: 720 }}>
          <span className="kicker accent">Nerio Premium</span>
          <h1 style={{ font: '400 clamp(38px,6vw,72px)/1 var(--serif)', letterSpacing: '-.025em', textWrap: 'balance' }}>Read new chapters the day they land.</h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: 560 }}>Premium is paid by bank transfer. Choose a plan, send the amount with your reference code, and we activate your account once the transfer arrives.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,400px),1fr))', gap: 'clamp(20px,3vw,32px)', alignItems: 'start' }}>
          <div className="stack" style={{ gap: 20 }}>
            <div role="radiogroup" aria-label="Plan" className="stack" style={{ gap: 10 }}>
              {PLANS.map((p, i) => {
                const on = site.plan === i;
                return (
                  <button key={p.name} type="button" role="radio" aria-checked={on} className="plan-option" onClick={() => site.set({ plan: i })}
                    style={{ borderColor: on ? 'var(--ember)' : undefined, background: on ? 'rgba(232,130,95,.06)' : undefined }}>
                    <span style={{ width: 20, height: 20, flex: 'none', borderRadius: '50%', border: `2px solid ${on ? 'var(--ember)' : 'var(--ink-5)'}`, display: 'grid', placeItems: 'center' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: on ? 'var(--ember)' : 'transparent' }} />
                    </span>
                    <span className="stack grow" style={{ gap: 2 }}><span style={{ font: '600 16px var(--sans)' }}>{p.name}</span><span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{p.sub}</span></span>
                    {p.save && <span className="badge success xs">{p.save}</span>}
                    <span style={{ font: '500 18px var(--mono)', letterSpacing: '-.02em' }}>{p.price}</span>
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
            <div className="stack">
              {bankRows.map(([label, value, kind, copyable]) => (
                <div key={label} className="row" style={{ gap: 12, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                  <div className="stack grow" style={{ gap: 3 }}>
                    <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>{label.toUpperCase()}</span>
                    <span style={{ font: kind === 'code' ? '500 18px var(--mono)' : `500 15px var(${kind === 'mono' ? '--mono' : '--sans'})`, color: kind === 'code' ? 'var(--ember-text)' : 'var(--ink-1)', wordBreak: 'break-all' }}>{value}</span>
                  </div>
                  {copyable && (
                    <Button variant="secondary" h={36} px={10} fs={12} icon={copied === label ? 'check' : 'content_copy'} aria-label={`Copy ${label}`}
                      onClick={() => copy(label, label === 'IBAN' ? value.replace(/\s/g, '') : value)}>{copied === label ? 'Copied' : 'Copy'}</Button>
                  )}
                </div>
              ))}
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
              <input className={`input mono ${invalid ? 'invalid' : ''}`} style={{ '--h': '48px' } as React.CSSProperties} value={site.payRef} onChange={e => site.set({ payRef: e.target.value })} placeholder="e.g. 2026100388213" aria-invalid={invalid} />
              <span style={{ fontSize: 13, color: invalid ? 'var(--danger-text)' : 'var(--ink-3)' }}>
                {invalid ? 'Enter the reference from your bank receipt (at least 6 characters).' : 'Found on your banking app’s receipt after the transfer.'}
              </span>
            </label>
            <Button variant="primary" h={52} loading={submitting} disabled={submitting} onClick={submit}>{submitting ? 'Submitting' : 'I have transferred'}</Button>
          </div>
        </div>
      </>}

      {site.pay === 'pending' && (
        <div className="stack" style={{ maxWidth: 620, margin: '0 auto', width: '100%', gap: 24, alignItems: 'center', textAlign: 'center', animation: 'pop .3s var(--ease)' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(230,194,106,.12)', display: 'grid', placeItems: 'center' }}>
            <Icon name="schedule" size={34} color="var(--warning)" style={{ animation: 'pulse 2s ease-in-out infinite' }} />
          </div>
          <h1 style={{ font: '400 clamp(32px,5vw,52px)/1.05 var(--serif)', letterSpacing: '-.02em' }}>We’re checking your transfer</h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: 460 }}>Bank transfers usually arrive within one business day. We’ll email you and activate Premium as soon as it’s matched.</p>
          <div className="panel stack" style={{ width: '100%', padding: 20, textAlign: 'left', borderColor: 'rgba(255,255,255,.08)' }}>
            <div className="row" style={{ gap: 14, padding: '12px 0' }}>
              <Icon name="check_circle" fill color="var(--success)" />
              <div className="stack" style={{ gap: 2 }}><span style={{ font: '600 15px var(--sans)' }}>Transfer submitted</span><span className="meta">REF {site.payRef || '2026100388213'} · TODAY 14:32</span></div>
            </div>
            <div className="row" style={{ gap: 14, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
              <span className="spinner" style={{ width: 20, height: 20, borderTopColor: 'var(--warning)', animationDuration: '1s' }} />
              <div className="stack" style={{ gap: 2 }}><span style={{ font: '600 15px var(--sans)' }}>Matching payment</span><span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{plan.name} · {plan.price} · code {BANK.code}</span></div>
            </div>
            <div className="row" style={{ gap: 14, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)', opacity: .5 }}>
              <Icon name="radio_button_unchecked" color="var(--ink-3)" /><span style={{ font: '600 15px var(--sans)' }}>Premium activated</span>
            </div>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button variant="secondary" fs={14} onClick={() => router.push('/')}>Keep reading free chapters</Button>
            <Button variant="ghost" fs={14} onClick={() => site.set({ pay: 'info' })}>Edit reference</Button>
          </div>
          <button type="button" className="proto-btn" onClick={() => { site.set({ pay: 'confirmed' }); site.toast('Premium activated', 'verified'); }}>PROTOTYPE · SIMULATE ADMIN CONFIRMATION</button>
        </div>
      )}

      {site.pay === 'confirmed' && (
        <div className="stack" style={{ maxWidth: 620, margin: '0 auto', width: '100%', gap: 24, alignItems: 'center', textAlign: 'center', animation: 'pop .3s var(--ease)' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(123,201,160,.12)', display: 'grid', placeItems: 'center' }}><Icon name="verified" fill size={36} color="var(--success)" /></div>
          <h1 style={{ font: '400 clamp(32px,5vw,52px)/1.05 var(--serif)', letterSpacing: '-.02em' }}>Premium is active</h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)' }}>Payment received. Your access runs until {plan.until}. There’s no auto-renewal.</p>
          <div className="card row" style={{ width: '100%', gap: 14, padding: 14, textAlign: 'left', borderColor: 'rgba(255,255,255,.08)' }}>
            <div style={{ width: 56, flex: 'none', aspectRatio: '3/4', borderRadius: 8, background: cover(SERIES[0].hue) }} />
            <div className="stack grow" style={{ gap: 3 }}><span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ember-text)' }}>NOW UNLOCKED</span><span style={{ font: '600 15px var(--sans)' }}>The Lantern Keeper · Ch. 113</span></div>
            <Button variant="primary" fs={14} onClick={() => router.push('/read/lantern/113')}>Read</Button>
          </div>
          <button type="button" className="proto-btn" onClick={() => { site.set({ pay: 'info', payRef: '' }); setTouched(false); }}>PROTOTYPE · RESET PAYMENT FLOW</button>
        </div>
      )}
    </div>
  );
}
