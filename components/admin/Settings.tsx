'use client';

import { Button, SwitchRow } from '@/components/ui';
import { BANK } from '@/lib/data';
import { useAdmin } from './store';

const TOGGLES: [string, string][] = [
  ['Require human QA for new series', 'First 3 chapters of every series always go to review'],
  ['Notify followers on publish', 'Email and in-app alert'],
  ['Pause pipeline overnight', '02:00–06:00 CET for maintenance'],
];

export default function Settings() {
  const { threshold, setThreshold, toggles, flipToggle, toast } = useAdmin();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 16, alignItems: 'start' }}>
      <section className="a-section">
        <span style={{ font: '400 22px var(--serif)' }}>Pipeline</span>
        <label className="field">
          <span className="row" style={{ justifyContent: 'space-between', font: '500 13px var(--sans)' }}>Auto-publish threshold<span className="mono" style={{ color: 'var(--ember-text)' }}>{(threshold / 100).toFixed(2)}</span></span>
          <input type="range" min={50} max={99} value={threshold} onChange={e => setThreshold(+e.target.value)} style={{ accentColor: 'var(--ember)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Chapters where every region scores above this skip the review queue.</span>
        </label>
        <label className="field" style={{ gap: 6 }}><span className="label">OCR engine</span><select className="a-input"><option>Nerio OCR v3 (Korean optimized)</option><option>Nerio OCR v2</option></select></label>
        <label className="field" style={{ gap: 6 }}><span className="label">Default typesetting font</span><select className="a-input"><option>Comic Neue · dialogue</option><option>Anime Ace · dialogue</option></select></label>
        {TOGGLES.map(([label, desc], i) => (
          <SwitchRow key={label} small label={label} desc={desc} on={toggles[i]} onToggle={() => flipToggle(i)} style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '12px 0 0' }} />
        ))}
      </section>
      <section className="a-section" style={{ gap: 14 }}>
        <span style={{ font: '400 22px var(--serif)' }}>Bank transfer details</span>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Shown to readers on the Premium page.</span>
        <label className="field" style={{ gap: 6 }}><span className="label">Account holder</span><input className="a-input" defaultValue={BANK.holder} /></label>
        <label className="field" style={{ gap: 6 }}><span className="label">IBAN</span><input className="a-input mono" defaultValue={BANK.iban} /></label>
        <label className="field" style={{ gap: 6 }}><span className="label">BIC / SWIFT</span><input className="a-input mono" defaultValue={BANK.bic} /></label>
        <Button variant="primary" h={40} style={{ alignSelf: 'flex-end' }} onClick={() => toast('Settings saved')}>Save</Button>
      </section>
    </div>
  );
}
