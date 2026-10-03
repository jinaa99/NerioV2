'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Button, Icon } from '@/components/ui';
import { loginAction, registerAction, type FormState } from '@/server/actions/auth';

function Field({ label, name, error, hint, mono, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> & { label: string; name: string; error?: string; hint?: string; mono?: boolean }) {
  const id = `f-${name}`;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} name={name} className={`input ${mono ? 'mono' : ''} ${error ? 'invalid' : ''}`} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined} {...rest} />
      {(error || hint) && <span id={`${id}-msg`} style={{ fontSize: 13, color: error ? 'var(--danger-text)' : 'var(--ink-3)' }}>{error ?? hint}</span>}
    </div>
  );
}

function PasswordField({ error, autoComplete, hint }: { error?: string; autoComplete: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label className="label" htmlFor="f-password" style={{ font: '500 13px var(--sans)' }}>Password</label>
        <button type="button" className="btn-link" style={{ fontSize: 13 }} onClick={() => setShow(s => !s)} aria-controls="f-password">{show ? 'Hide' : 'Show'}</button>
      </div>
      <input id="f-password" name="password" type={show ? 'text' : 'password'} className={`input ${error ? 'invalid' : ''}`} required minLength={autoComplete === 'new-password' ? 8 : 1} maxLength={128}
        autoComplete={autoComplete} aria-invalid={!!error} aria-describedby={error || hint ? 'f-password-msg' : undefined} />
      {(error || hint) && <span id="f-password-msg" style={{ fontSize: 13, color: error ? 'var(--danger-text)' : 'var(--ink-3)' }}>{error ?? hint}</span>}
    </div>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="row" style={{ gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(229,103,92,.1)', border: '1px solid rgba(229,103,92,.3)', color: 'var(--danger-text)', fontSize: 14 }}>
      <Icon name="error" size={18} />{message}
    </div>
  );
}

function GoogleButton({ next, label }: { next: string; label: string }) {
  // Plain link: the flow starts with a full-page GET to the route handler, which redirects to Google.
  return (
    <>
      <a href={authHref('/auth/google', next)} className="btn btn-secondary" style={{ '--h': '48px', '--px': '18px', '--r': '12px', '--fs': '15px', width: '100%', gap: 10 } as React.CSSProperties}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {label}
      </a>
      <div className="row" style={{ gap: 12, font: '500 11px var(--mono)', letterSpacing: '.1em', color: 'var(--ink-4)' }}>
        <span className="grow" style={{ height: 1, background: 'var(--line-1)' }} />OR<span className="grow" style={{ height: 1, background: 'var(--line-1)' }} />
      </div>
    </>
  );
}

const authHref = (path: string, next: string) => (next && next !== '/' ? `${path}?next=${encodeURIComponent(next)}` : path);

export function LoginForm({ next, google, notice }: { next: string; google: boolean; notice?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="panel stack" style={{ gap: 18 }}>
      <input type="hidden" name="next" value={next} />
      <FormError message={state.error ?? notice} />
      {google && <GoogleButton next={next} label="Continue with Google" />}
      <Field label="Email" name="email" type="email" autoComplete="email" required maxLength={320} defaultValue={state.values?.email} />
      <PasswordField autoComplete="current-password" />
      <Button type="submit" variant="primary" h={48} loading={pending} disabled={pending} style={{ width: '100%' }}>{pending ? 'Signing in…' : 'Sign in'}</Button>
      <span style={{ fontSize: 14, color: 'var(--ink-3)', textAlign: 'center' }}>
        New to Nerio? <Link href={authHref('/register', next)} style={{ color: 'var(--ink-1)', fontWeight: 500 }}>Create an account</Link>
      </span>
    </form>
  );
}

export function RegisterForm({ next, google }: { next: string; google: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(registerAction, {});
  const err = (k: string) => state.fields?.[k]?.[0];
  // Field-level errors render under their inputs; the banner is for everything else.
  const banner = state.error && !state.fields ? state.error : undefined;
  return (
    <form action={action} className="panel stack" style={{ gap: 18 }}>
      <input type="hidden" name="next" value={next} />
      <FormError message={banner} />
      {google && <GoogleButton next={next} label="Sign up with Google" />}
      <Field label="Display name" name="displayName" autoComplete="name" required maxLength={64} defaultValue={state.values?.displayName} error={err('displayName')} />
      <Field label="Username" name="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.]{3,32}" mono
        defaultValue={state.values?.username} error={err('username')} hint="3–32 letters, numbers, dots or underscores" />
      <Field label="Email" name="email" type="email" autoComplete="email" required maxLength={320} defaultValue={state.values?.email} error={err('email')} />
      <PasswordField autoComplete="new-password" error={err('password')} hint="At least 8 characters" />
      <Button type="submit" variant="primary" h={48} loading={pending} disabled={pending} style={{ width: '100%' }}>{pending ? 'Creating account…' : 'Create account'}</Button>
      <span style={{ fontSize: 14, color: 'var(--ink-3)', textAlign: 'center' }}>
        Already have an account? <Link href={authHref('/login', next)} style={{ color: 'var(--ink-1)', fontWeight: 500 }}>Sign in</Link>
      </span>
    </form>
  );
}
