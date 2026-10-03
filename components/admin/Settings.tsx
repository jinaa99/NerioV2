'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, SwitchRow } from '@/components/ui';
import { updateSettingsAction } from '@/server/actions/admin';
import type { Settings as SettingsDTO } from '@/server/data/settings';
import { useAdmin } from './store';

const TOGGLES: [keyof SettingsDTO, string, string][] = [
  ['requireQaForNewSeries', 'Require human QA for new series', 'First 3 chapters of every series always go to review'],
  ['notifyFollowersOnPublish', 'Notify followers on publish', 'In-app alert to followers with alerts on'],
  ['pausePipeline', 'Pause pipeline', 'Workers stop picking up queued jobs until resumed'],
];
const BANK: [keyof SettingsDTO, string, boolean][] = [['bankHolder', 'Account holder', false], ['bankName', 'Bank', false], ['bankIban', 'IBAN', true], ['bankBic', 'BIC / SWIFT', true]];

export default function Settings({ settings }: { settings: SettingsDTO }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const [pipeline, setPipeline] = useState(settings);
  const [bank, setBank] = useState({ bankHolder: settings.bankHolder, bankName: settings.bankName, bankIban: settings.bankIban, bankBic: settings.bankBic });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, start] = useTransition();

  const save = (patch: Partial<SettingsDTO>, ok: string, revert?: () => void) => start(async () => {
    const res = await updateSettingsAction(patch);
    if (!res.ok) {
      revert?.();
      setErrors(Object.fromEntries(Object.entries(res.fields ?? {}).map(([k, v]) => [k, v[0]])));
      return toast(res.error, 'error', 'var(--danger)');
    }
    setErrors({});
    toast(ok);
    router.refresh();
  });
  const toggle = (k: keyof SettingsDTO) => {
    const prev = pipeline[k] as boolean;
    setPipeline(p => ({ ...p, [k]: !prev }));
    save({ [k]: !prev }, 'Setting saved', () => setPipeline(p => ({ ...p, [k]: prev })));
  };
  const bankDirty = BANK.some(([k]) => bank[k as keyof typeof bank] !== settings[k]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 16, alignItems: 'start' }}>
      <section className="a-section">
        <span style={{ font: '400 22px var(--serif)' }}>Pipeline</span>
        <label className="field">
          <span className="row" style={{ justifyContent: 'space-between', font: '500 13px var(--sans)' }}>Auto-publish threshold<span className="mono" style={{ color: 'var(--ember-text)' }}>{pipeline.autoPublishThreshold.toFixed(2)}</span></span>
          <input type="range" min={50} max={99} value={Math.round(pipeline.autoPublishThreshold * 100)} aria-label="Auto-publish threshold"
            onChange={e => setPipeline(p => ({ ...p, autoPublishThreshold: +e.target.value / 100 }))}
            onPointerUp={() => pipeline.autoPublishThreshold !== settings.autoPublishThreshold && save({ autoPublishThreshold: pipeline.autoPublishThreshold }, 'Threshold saved')}
            onKeyUp={() => pipeline.autoPublishThreshold !== settings.autoPublishThreshold && save({ autoPublishThreshold: pipeline.autoPublishThreshold }, 'Threshold saved')}
            style={{ accentColor: 'var(--ember)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Chapters where every region scores above this skip the review queue.</span>
        </label>
        <label className="field" style={{ gap: 6 }}><span className="label">OCR engine</span>
          <select className="a-input" value={pipeline.ocrEngine} disabled={saving} onChange={e => { const v = e.target.value as SettingsDTO['ocrEngine']; setPipeline(p => ({ ...p, ocrEngine: v })); save({ ocrEngine: v }, 'OCR engine saved'); }}>
            <option value="nerio-ocr-v3">Nerio OCR v3 (Korean optimized)</option><option value="nerio-ocr-v2">Nerio OCR v2</option>
          </select>
        </label>
        <label className="field" style={{ gap: 6 }}><span className="label">Default typesetting font</span>
          <select className="a-input" value={pipeline.typesetFont} disabled={saving} onChange={e => { const v = e.target.value as SettingsDTO['typesetFont']; setPipeline(p => ({ ...p, typesetFont: v })); save({ typesetFont: v }, 'Font saved'); }}>
            <option value="comic-neue">Comic Neue · dialogue</option><option value="anime-ace">Anime Ace · dialogue</option>
          </select>
        </label>
        {TOGGLES.map(([key, label, desc]) => (
          <SwitchRow key={key} small label={label} desc={desc} on={pipeline[key] as boolean} onToggle={() => !saving && toggle(key)} style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '12px 0 0' }} />
        ))}
      </section>
      <form className="a-section" style={{ gap: 14 }} onSubmit={e => { e.preventDefault(); save(bank, 'Bank details saved'); }}>
        <span style={{ font: '400 22px var(--serif)' }}>Bank transfer details</span>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Shown to readers on the Premium page. Changes are recorded in the audit log.</span>
        {BANK.map(([key, label, mono]) => (
          <label key={key} className="field" style={{ gap: 6 }}><span className="label">{label}</span>
            <input className={`a-input ${mono ? 'mono' : ''}`} value={bank[key as keyof typeof bank]} maxLength={120} aria-invalid={!!errors[key]}
              onChange={e => setBank(b => ({ ...b, [key]: e.target.value }))} style={{ borderColor: errors[key] ? 'var(--danger)' : undefined }} />
            {errors[key] && <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{errors[key]}</span>}
          </label>
        ))}
        <Button type="submit" variant="primary" h={40} disabled={!bankDirty || saving} loading={saving && bankDirty} style={{ alignSelf: 'flex-end' }}>Save</Button>
      </form>
    </div>
  );
}
