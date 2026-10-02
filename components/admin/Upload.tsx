'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { Button, Icon, IconButton } from '@/components/ui';
import { ADMIN_SERIES, STAGES, STAGE_DESC, adminSeries } from '@/lib/admin-data';
import { useAdmin, type UploadPhase } from './store';

const PHASE: Record<UploadPhase, [string, string]> = {
  form: ['WAITING FOR FILE', 'neutral'], uploading: ['UPLOADING', 'ember'], processing: ['PROCESSING', 'ember'],
  failed: ['FAILED', 'danger'], ready: ['READY', 'info'], published: ['PUBLISHED', 'success'],
};
const START_LABEL: Record<UploadPhase, string> = { form: 'Upload and process', uploading: 'Uploading…', processing: 'Processing…', failed: 'Failed, see status', ready: 'Processed', published: 'Published' };

export default function Upload() {
  const { up: u, setUp, startUpload, toast } = useAdmin();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const locked = u.phase !== 'form';
  const series = adminSeries(u.series);
  const dup = +u.num <= series.ch;
  const size = u.file ? (u.file.size > 1e5 ? `${(u.file.size / 1048576).toFixed(1)} MB` : '186.4 MB') : '';

  const accept = (f?: File) => {
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return setUp({ err: `“${f.name}” isn’t a ZIP archive.`, drag: false });
    setUp({ file: { name: f.name, size: f.size }, err: '', drag: false });
  };
  const start = () => {
    if (!u.file) setUp({ file: { name: `lantern-keeper_ch${u.num}_raw.zip`, size: 0 } });
    setTimeout(() => startUpload(), 0);
  };

  const [phaseLabel, phaseTone] = PHASE[u.phase];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, alignItems: 'start' }}>
      <section className="a-section" style={{ padding: 'clamp(18px,3vw,24px)', gap: 18 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span style={{ font: '400 24px var(--serif)' }}>New chapter</span>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Upload raw pages. Nerio runs OCR, translation, cleaning and typesetting automatically.</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 14 }}>
          <label className="field" style={{ gridColumn: '1/-1', gap: 6 }}>
            <span className="label">Series</span>
            <select className="a-input" value={u.series} disabled={locked} onChange={e => setUp({ series: e.target.value, num: String(adminSeries(e.target.value).ch + 1) })}>
              {ADMIN_SERIES.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </label>
          <label className="field" style={{ gap: 6 }}>
            <span className="label">Chapter number</span>
            <input className="a-input mono" inputMode="numeric" value={u.num} disabled={locked} onChange={e => setUp({ num: e.target.value.replace(/[^0-9.]/g, '') })} style={{ borderColor: dup ? 'rgba(230,194,106,.5)' : undefined }} />
            {dup && <span style={{ fontSize: 12, color: 'var(--warning-text)' }}>Chapter {u.num} already exists. Uploading replaces it.</span>}
          </label>
          <label className="field" style={{ gap: 6 }}>
            <span className="label">Title <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>optional</span></span>
            <input className="a-input" value={u.title} disabled={locked} placeholder="Auto-detect" onChange={e => setUp({ title: e.target.value })} />
          </label>
          <label className="field" style={{ gap: 6 }}><span className="label">Source</span><select className="a-input" disabled={locked}><option>Korean</option><option>Japanese</option><option>Chinese</option></select></label>
          <label className="field" style={{ gap: 6 }}><span className="label">Target</span><select className="a-input" disabled={locked}><option>English</option><option>Spanish</option><option>Indonesian</option></select></label>
        </div>

        {!u.file && <>
          <div role="button" tabIndex={0} aria-label="Upload chapter ZIP" className={`dropzone ${u.drag ? 'drag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
            onDragOver={e => { e.preventDefault(); if (!u.drag) setUp({ drag: true }); }}
            onDragLeave={() => setUp({ drag: false })}
            onDrop={e => { e.preventDefault(); accept(e.dataTransfer.files[0]); }}>
            <Icon name={u.drag ? 'download' : 'folder_zip'} size={32} color={u.drag ? 'var(--ember)' : 'var(--ink-2)'} />
            <span style={{ font: '600 15px var(--sans)' }}>{u.drag ? 'Release to add' : 'Drop chapter ZIP or click to browse'}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>ZIP of JPG, PNG or WEBP pages · up to 500 MB · pages sorted by filename</span>
          </div>
          <input ref={fileRef} type="file" accept=".zip" hidden onChange={e => accept(e.target.files?.[0])} />
          {u.err && (
            <div className="row" style={{ gap: 10, padding: 12, borderRadius: 10, background: 'rgba(229,103,92,.08)', border: '1px solid rgba(229,103,92,.25)', fontSize: 13, color: 'var(--danger-text)' }}>
              <Icon name="error" size={18} />{u.err}
            </div>
          )}
        </>}

        {u.file && (
          <div className="row" style={{ gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--s2)', border: '1px solid rgba(255,255,255,.08)' }}>
            <Icon name="folder_zip" size={26} color="var(--ink-2)" />
            <div className="stack grow" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <span className="ellipsis" style={{ font: '600 14px var(--sans)' }}>{u.file.name}</span>
                <span className="meta" style={{ flex: 'none' }}>{u.phase === 'uploading' ? `${u.uploadPct}% · ${size}` : `${size} · 48 PAGES`}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--s4)', overflow: 'hidden' }}>
                <div style={{ width: `${u.phase === 'form' ? 0 : u.uploadPct}%`, height: '100%', background: 'var(--ink-1)', transition: 'width .2s linear' }} />
              </div>
            </div>
            {!locked && <IconButton icon="close" label="Remove file" h={32} r={8} iconSize={18} style={{ color: 'var(--ink-3)' }} onClick={() => setUp({ file: null })} />}
          </div>
        )}

        <label className="row" style={{ gap: 10, fontSize: 13, color: 'var(--ink-2)' }}>
          <input type="checkbox" checked={u.simFail} disabled={locked} onChange={() => setUp({ simFail: !u.simFail })} style={{ accentColor: 'var(--ember)', width: 16, height: 16 }} />
          Prototype: simulate an OCR failure
        </label>
        <Button variant="primary" h={44} fs={14} disabled={locked} onClick={start}>{START_LABEL[u.phase]}</Button>
      </section>

      <section aria-live="polite" className="a-section" style={{ padding: 'clamp(18px,3vw,24px)', gap: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="stack" style={{ gap: 2 }}>
            <span style={{ font: '600 15px var(--sans)' }}>Processing status</span>
            <span className="meta">{u.phase === 'form' ? 'NO ACTIVE JOB' : `JOB-8822 · ${series.title.toUpperCase()} · CH. ${u.num}`}</span>
          </div>
          <span className={`badge xs ${phaseTone}`}>{phaseLabel}</span>
        </div>
        <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {STAGES.map((name, i) => {
            let done = false, active = false, failed = false;
            if (u.phase === 'processing') { done = i < u.stage; active = i === u.stage; }
            else if (u.phase === 'failed') { done = i < 1; failed = i === 1; }
            else if (u.phase === 'ready') done = i < 7;
            else if (u.phase === 'published') done = true;
            const readyStep = u.phase === 'ready' && i === 7;
            const color = done ? 'var(--success)' : failed ? 'var(--danger)' : active ? 'var(--ember)' : readyStep ? 'var(--info)' : 'var(--s4)';
            return (
              <li key={name} className="row" style={{ gap: 14, alignItems: 'stretch' }}>
                <div className="stack" style={{ alignItems: 'center', width: 22, flex: 'none' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: done || failed ? color : readyStep ? 'rgba(134,169,222,.2)' : 'transparent', border: `1.5px solid ${color}`, color: 'var(--bg)', transition: 'all .3s' }}>
                    {done && <Icon name="check" size={14} style={{ fontWeight: 600 }} />}
                    {failed && <Icon name="close" size={14} style={{ fontWeight: 600 }} />}
                    {active && <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(232,130,95,.3)', borderTopColor: 'var(--ember)', animation: 'spin .8s linear infinite' }} />}
                  </span>
                  {i < 8 && <span style={{ flex: 1, width: 1.5, minHeight: 14, background: done ? 'var(--success)' : 'var(--s4)', transition: 'background .3s' }} />}
                </div>
                <div className="stack grow" style={{ gap: 6, padding: '1px 0 14px' }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ font: '600 12px var(--mono)', letterSpacing: '.06em', color: done ? 'var(--success-text)' : failed ? 'var(--danger-text)' : active ? 'var(--ember-text)' : readyStep ? 'var(--info-text)' : 'var(--ink-4)' }}>{name}</span>
                    <span className="meta">{u.times[i] || (active ? `${Math.round(u.stagePct)}%` : '')}</span>
                  </div>
                  {(active || failed || readyStep) && <span style={{ fontSize: 13, color: failed ? 'var(--danger-text)' : 'var(--ink-2)' }}>{failed ? 'Page 31 timed out after 120s. 30 of 48 pages processed.' : STAGE_DESC[i]}</span>}
                  {active && (
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--s4)', overflow: 'hidden' }}>
                      <div style={{ width: `${u.stagePct}%`, height: '100%', borderRadius: 2, background: 'repeating-linear-gradient(90deg,#E8825F 0 10px,#F09A79 10px 14px)', animation: 'stripe .8s linear infinite', transition: 'width .25s linear' }} />
                    </div>
                  )}
                  {failed && (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Button variant="secondary" h={32} px={12} icon="refresh" onClick={() => startUpload(true)}>Retry from OCR</Button>
                      <Button variant="ghost" h={32} onClick={() => toast('ocr-worker-2: page_031.jpg timeout after 120000ms', 'terminal', 'var(--ink-2)')}>View logs</Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {u.phase === 'ready' && (
          <div className="stack" style={{ gap: 12, padding: 16, borderRadius: 12, background: 'rgba(123,201,160,.06)', border: '1px solid rgba(123,201,160,.22)', animation: 'pop .3s' }}>
            <span style={{ font: '600 14px var(--sans)' }}>Ready to publish · 3 regions flagged in QA</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button variant="secondary" h={40} onClick={() => router.push('/admin/review')}>Review translation</Button>
              <Button variant="primary" h={40} onClick={() => { setUp({ phase: 'published', times: [...u.times, 'now'] }); toast(`Chapter ${u.num} published`); }}>Publish now</Button>
            </div>
          </div>
        )}
        {u.phase === 'published' && (
          <div className="row" style={{ gap: 12, padding: 16, borderRadius: 12, background: 'rgba(123,201,160,.08)', border: '1px solid rgba(123,201,160,.25)', animation: 'pop .3s' }}>
            <Icon name="check_circle" fill color="var(--success)" />
            <span className="grow" style={{ font: '600 14px var(--sans)' }}>Published. Followers are being notified.</span>
            <Button variant="outline" h={36} px={12} onClick={() => setUp({ phase: 'form', file: null, num: String(+u.num + 1), uploadPct: 0, stage: 0, times: [] })}>Upload another</Button>
          </div>
        )}
      </section>
    </div>
  );
}
