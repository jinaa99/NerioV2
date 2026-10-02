'use client';

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';

export function Icon({ name, fill, size, color, style, className = '' }: { name: string; fill?: boolean; size?: number; color?: string; style?: CSSProperties; className?: string }) {
  return (
    <span aria-hidden className={`ms ${fill ? 'fill' : ''} ${className}`} style={{ fontSize: size, color, ...style }}>
      {name}
    </span>
  );
}

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'accent' | 'danger' | 'success' | 'link';

export function Button({
  variant = 'secondary', h = 44, px, r, fs, icon, iconFill, loading, children, style, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; h?: number; px?: number; r?: number; fs?: number; icon?: string; iconFill?: boolean; loading?: boolean }) {
  const vars = {
    '--h': `${h}px`,
    '--px': `${px ?? (h <= 32 ? 10 : h <= 40 ? 14 : 18)}px`,
    '--r': `${r ?? (h <= 32 ? 8 : h >= 48 ? 12 : 10)}px`,
    '--fs': `${fs ?? (h <= 32 ? 12 : h <= 40 ? 13 : h >= 52 ? 16 : 15)}px`,
  } as CSSProperties;
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} style={{ ...vars, ...style }} {...rest}>
      {loading && <span className={`spinner ${variant === 'primary' ? 'dark' : ''}`} />}
      {icon && !loading && <Icon name={icon} fill={iconFill} size={h <= 32 ? 16 : 18} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, h = 44, r, variant = 'plain', fill, iconSize, iconColor, style, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; h?: number; r?: number; variant?: 'plain' | 'boxed' | 'round' | 'solid'; fill?: boolean; iconSize?: number; iconColor?: string }) {
  const cls = variant === 'plain' ? '' : variant === 'solid' ? 'solid round' : variant;
  return (
    <button type="button" aria-label={label} className={`icon-btn ${cls} ${className}`} style={{ '--h': `${h}px`, '--r': r ? `${r}px` : undefined, ...style } as CSSProperties} {...rest}>
      <Icon name={icon} fill={fill} size={iconSize} color={iconColor} />
    </button>
  );
}

export function Cover({ bg, width, radius, tag, children, style, className = '' }: { bg: string; width?: number | string; radius?: number; tag?: string; children?: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={`cover ${className}`} style={{ background: bg, width, borderRadius: radius, ...style }}>
      {tag && <span className="cover-tag">{tag}</span>}
      {children}
    </div>
  );
}

export function Switch({ on, small }: { on: boolean; small?: boolean }) {
  return <span aria-hidden className={`switch ${small ? 'sm' : ''} ${on ? 'on' : ''}`} />;
}

export function SwitchRow({ on, onToggle, label, desc, small, style }: { on: boolean; onToggle: () => void; label: string; desc?: string; small?: boolean; style?: CSSProperties }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="switch-row" style={style}>
      <span className="stack" style={{ gap: 3 }}>
        <span style={{ font: `500 ${small ? 14 : 15}px var(--sans)` }}>{label}</span>
        {desc && <span style={{ fontSize: small ? 12 : 13, color: 'var(--ink-3)' }}>{desc}</span>}
      </span>
      <Switch on={on} small={small} />
    </button>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, h, stretch, role = 'tab', label, bg }: { options: [T, string][]; value: T; onChange: (v: T) => void; h?: number; stretch?: boolean; role?: 'tab' | 'radio'; label?: string; bg?: string }) {
  return (
    <div role={role === 'tab' ? 'tablist' : 'radiogroup'} aria-label={label} className={`seg ${stretch ? 'stretch' : ''}`} style={{ '--h': h ? `${h}px` : undefined, background: bg } as CSSProperties}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role={role}
          {...(role === 'tab' ? { 'aria-selected': v === value } : { 'aria-checked': v === value })}
          onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Bar({ pct, color, h = 3, track }: { pct: number; color?: string; h?: number; track?: string }) {
  return (
    <div className="bar" style={{ height: h, background: track }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

/* ───────────── Toasts ───────────── */

export type Toast = { id: number; text: string; icon: string; color: string; undo?: () => void };
export type PushToast = (text: string, icon?: string, color?: string, undo?: () => void) => void;

export function useToastQueue(duration = 3200) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const dismiss = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);
  const push: PushToast = useCallback((text, icon = 'check_circle', color = 'var(--success)', undo) => {
    const id = ++seq.current;
    setToasts(t => [...t.slice(-2), { id, text, icon, color, undo }]);
    timers.current.push(window.setTimeout(() => dismiss(id), duration));
  }, [dismiss, duration]);
  return { toasts, push, dismiss };
}

export function ToastViewport({ toasts, dismiss, bottom, align = 'center' }: { toasts: Toast[]; dismiss: (id: number) => void; bottom?: string; align?: 'center' | 'right' }) {
  const pos: CSSProperties = align === 'right'
    ? { left: 'auto', right: 20, transform: 'none', width: 'min(360px, calc(100% - 40px))', bottom }
    : { bottom };
  return (
    <div aria-live="polite" className="toasts" style={pos}>
      {toasts.map(t => (
        <div role="status" key={t.id} className="toast">
          <Icon name={t.icon} fill color={t.color} />
          <span className="grow">{t.text}</span>
          {t.undo && (
            <button type="button" className="btn-link" style={{ color: 'var(--ember)', font: '600 13px var(--sans)', background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => { t.undo?.(); dismiss(t.id); }}>Undo</button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ───────────── Hooks ───────────── */

export function useViewportWidth(fallback = 1440) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export function useEscape(handler: () => void, active = true) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [active]);
}
