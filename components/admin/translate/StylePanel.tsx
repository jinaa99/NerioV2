'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { FONT_LABEL, TYPESET_FONTS, typesetStyleOverride, type TypesetStyleOverride } from '@/lib/typeset-style';

const num = (value: string, fallback?: number) => { const n = Number(value); return value.trim() === '' || !Number.isFinite(n) ? fallback : n; };

/** Per-segment lettering overrides. Empty fields fall back to the shared typesetting style. */
export default function StylePanel({ value, busy, onApply }: { value: Record<string, unknown>; busy: boolean; onApply: (style: TypesetStyleOverride | null) => void }) {
  const initial = typesetStyleOverride.safeParse(value).success ? (value as TypesetStyleOverride) : {};
  const [style, setStyle] = useState<TypesetStyleOverride>(initial);
  const [error, setError] = useState('');
  const set = <K extends keyof TypesetStyleOverride>(key: K, v: TypesetStyleOverride[K] | undefined) => setStyle(s => {
    const next = { ...s };
    if (v === undefined) delete next[key]; else next[key] = v;
    return next;
  });
  const field = { display: 'grid', gap: 4, fontSize: 11, color: 'var(--ink-3)' } as const;
  const input = { height: 30, fontSize: 12 } as const;
  const apply = () => {
    const parsed = typesetStyleOverride.safeParse(style);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the values.');
    setError(''); onApply(Object.keys(parsed.data).length ? parsed.data : null);
  };

  return (
    <div className="stack" style={{ gap: 10, padding: 12, borderRadius: 10, background: 'var(--s2)' }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8 }}>
        <label style={field}>Font
          <select className="a-input" style={input} value={style.fontFamily ?? ''} onChange={e => set('fontFamily', (e.target.value || undefined) as TypesetStyleOverride['fontFamily'])}>
            <option value="">Default</option>{TYPESET_FONTS.map(f => <option key={f} value={f}>{FONT_LABEL[f]}</option>)}
          </select>
        </label>
        <label style={field}>Size (px)
          <input className="a-input mono" style={input} inputMode="numeric" placeholder="Auto" value={style.fontSize ?? ''} onChange={e => set('fontSize', num(e.target.value) === undefined ? undefined : Math.round(num(e.target.value)!))} />
        </label>
        <label style={field}>Min size
          <input className="a-input mono" style={input} inputMode="numeric" placeholder="Default" value={style.minFontSize ?? ''} onChange={e => set('minFontSize', num(e.target.value) === undefined ? undefined : Math.round(num(e.target.value)!))} />
        </label>
        <label style={field}>Max size
          <input className="a-input mono" style={input} inputMode="numeric" placeholder="Default" value={style.maxFontSize ?? ''} onChange={e => set('maxFontSize', num(e.target.value) === undefined ? undefined : Math.round(num(e.target.value)!))} />
        </label>
        <label style={field}>Align
          <select className="a-input" style={input} value={style.align ?? ''} onChange={e => set('align', (e.target.value || undefined) as TypesetStyleOverride['align'])}>
            <option value="">Default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </label>
        <label style={field}>Vertical
          <select className="a-input" style={input} value={style.verticalAlign ?? ''} onChange={e => set('verticalAlign', (e.target.value || undefined) as TypesetStyleOverride['verticalAlign'])}>
            <option value="">Default</option><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
          </select>
        </label>
        <label style={field}>Line height
          <input className="a-input mono" style={input} inputMode="decimal" placeholder="Default" value={style.lineHeight ?? ''} onChange={e => set('lineHeight', num(e.target.value))} />
        </label>
        <label style={field}>Letter spacing (em)
          <input className="a-input mono" style={input} inputMode="decimal" placeholder="0" value={style.letterSpacing ?? ''} onChange={e => set('letterSpacing', num(e.target.value))} />
        </label>
        <label style={field}>Padding
          <input className="a-input mono" style={input} inputMode="decimal" placeholder="Default" value={style.padding ?? ''} onChange={e => set('padding', num(e.target.value))} />
        </label>
        <label style={field}>Offset X (px)
          <input className="a-input mono" style={input} inputMode="numeric" placeholder="0" value={style.offsetX ?? ''} onChange={e => set('offsetX', num(e.target.value) === undefined ? undefined : Math.round(num(e.target.value)!))} />
        </label>
        <label style={field}>Offset Y (px)
          <input className="a-input mono" style={input} inputMode="numeric" placeholder="0" value={style.offsetY ?? ''} onChange={e => set('offsetY', num(e.target.value) === undefined ? undefined : Math.round(num(e.target.value)!))} />
        </label>
        <label style={field}>Outline width
          <input className="a-input mono" style={input} inputMode="decimal" placeholder="Auto" value={style.strokeWidth ?? ''} onChange={e => set('strokeWidth', num(e.target.value))} />
        </label>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!style.bold} onChange={e => set('bold', e.target.checked || undefined)} />Bold</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!style.italic} onChange={e => set('italic', e.target.checked || undefined)} />Italic</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!style.shadow} onChange={e => set('shadow', e.target.checked || undefined)} />Shadow</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!style.color} onChange={e => set('color', e.target.checked ? '#111111' : undefined)} />Text colour
          {style.color && <input type="color" value={style.color} onChange={e => set('color', e.target.value)} />}
        </label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!style.strokeColor} onChange={e => set('strokeColor', e.target.checked ? '#ffffff' : undefined)} />Outline colour
          {style.strokeColor && <input type="color" value={style.strokeColor} onChange={e => set('strokeColor', e.target.value)} />}
        </label>
      </div>
      {error && <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{error}</span>}
      <div className="row" style={{ gap: 8 }}>
        <Button variant="secondary" h={30} loading={busy} onClick={apply}>Apply style</Button>
        <Button variant="ghost" h={30} disabled={busy} onClick={() => { setStyle({}); onApply(null); }}>Reset to default</Button>
      </div>
    </div>
  );
}
