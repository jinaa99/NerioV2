'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/ui';
import type { FormState } from '@/server/actions/auth';

/** First error for a field, including nested paths like `altTitles.2`. */
export function fieldError(state: FormState, name: string): string | undefined {
  const f = state.fields;
  if (!f) return undefined;
  if (f[name]?.length) return f[name][0];
  const nested = Object.keys(f).find(k => k.startsWith(`${name}.`));
  return nested ? f[nested][0] : undefined;
}

export function Field({ label, htmlFor, error, hint, children, span }: { label: string; htmlFor: string; error?: string; hint?: ReactNode; children: ReactNode; span?: boolean }) {
  return (
    <div className="field" style={span ? { gridColumn: '1 / -1' } : undefined}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {(error || hint) && <span id={`${htmlFor}-msg`} style={{ fontSize: 12, color: error ? 'var(--danger-text)' : 'var(--ink-3)' }}>{error ?? hint}</span>}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="row" style={{ gap: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(229,103,92,.1)', border: '1px solid rgba(229,103,92,.3)', color: 'var(--danger-text)', fontSize: 13 }}>
      <Icon name="error" size={18} />{message}
    </div>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="a-card stack">
      <div className="a-section-head"><span style={{ font: '600 14px var(--sans)' }}>{title}</span>{aside}</div>
      <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 16 }}>{children}</div>
    </section>
  );
}

export const inputStyle = { '--h': '40px', fontSize: 14 } as React.CSSProperties;
export const textareaStyle = { height: 'auto', padding: '10px 14px', fontSize: 14, lineHeight: 1.5, resize: 'vertical' } as React.CSSProperties;

/** `datetime-local` value (editor's local time) ↔ ISO string. */
export const toLocalInput = (d: Date | string | null | undefined) => {
  if (!d) return '';
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '');
