'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Icon, Segmented } from '@/components/ui';
import { chapterNo } from '@/lib/catalog';
import { publishUploadedAction, uploadChapterAction } from '@/server/actions/admin';
import { PIPELINE_STAGE_DESC, PIPELINE_STAGE_LABEL, PIPELINE_STAGE_ORDER } from './pipeline-ui';
import { useAdmin } from './store';

type SeriesOption = { id: string; title: string; sourceLanguage: string; nextNumber: number };
type Measured = { url: string; width: number; height: number };
type Result = { chapterId: string; jobId: string | null; series: string; number: number; pages: number; mode: 'process' | 'direct'; published?: boolean };

const SOURCES: [string, string][] = [['ko', 'Korean'], ['ja', 'Japanese'], ['zh', 'Chinese']];
const TARGETS: [string, string][] = [['mn', 'Mongolian'], ['en', 'English'], ['es', 'Spanish'], ['id', 'Indonesian']];

/** Load each image in the browser to read its size; the server only stores what it's given. */
function measure(url: string): Promise<Measured> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const t = setTimeout(() => reject(new Error('timeout')), 20_000);
    img.onload = () => { clearTimeout(t); resolve({ url, width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(t); reject(new Error('load failed')); };
    img.src = url;
  });
}

export default function Upload({ options, initialSeries }: { options: SeriesOption[]; initialSeries?: string }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const first = options.find(o => o.id === initialSeries) ?? options[0];
  const [seriesId, setSeriesId] = useState(first?.id ?? '');
  const [num, setNum] = useState(String(first?.nextNumber ?? 1));
  const [title, setTitle] = useState('');
  const [source, setSource] = useState(first?.sourceLanguage ?? 'ko');
  const [target, setTarget] = useState('mn');
  const [mode, setMode] = useState<'process' | 'direct'>('process');
  const [urls, setUrls] = useState('');
  const [err, setErr] = useState('');
  const [phase, setPhase] = useState<'form' | 'checking' | 'saving' | 'done'>('form');
  const [checked, setChecked] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [publishing, startPublish] = useTransition();
  const locked = phase !== 'form';
  const series = options.find(o => o.id === seriesId);
  const list = urls.split('\n').map(s => s.trim()).filter(Boolean);

  if (options.length === 0) {
    return (
      <div className="a-card stack" style={{ padding: 48, alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <Icon name="collections_bookmark" size={28} color="var(--ink-3)" />
        <span style={{ font: '600 15px var(--sans)' }}>Create a series first</span>
        <Link href="/admin/series/new" className="btn btn-primary" style={{ '--h': '36px', '--fs': '13px', color: 'var(--bg)' } as React.CSSProperties}>New series</Link>
      </div>
    );
  }

  const start = async () => {
    setErr('');
    const n = Number(num);
    if (!num || !Number.isFinite(n) || n < 0) return setErr('Enter a chapter number.');
    if (list.length === 0) return setErr('Add at least one page image URL.');
    const bad = list.find(u => !/^https:\/\/\S+$/.test(u));
    if (bad) return setErr(`Not an https URL: ${bad}`);
    setPhase('checking');
    setChecked(0);
    const results = await Promise.allSettled(list.map(u => measure(u).finally(() => setChecked(c => c + 1))));
    const failedIdx = results.findIndex(r => r.status === 'rejected');
    if (failedIdx !== -1) {
      setPhase('form');
      return setErr(`Page ${failedIdx + 1} didn’t load: ${list[failedIdx]}`);
    }
    setPhase('saving');
    const pages = results.map(r => (r as PromiseFulfilledResult<Measured>).value);
    const res = await uploadChapterAction({ seriesId, number: n, title, sourceLanguage: source, targetLanguage: target, mode, pages });
    if (!res.ok) {
      setPhase('form');
      return setErr(Object.values(res.fields ?? {})[0]?.[0] ?? res.error);
    }
    setResult({ chapterId: res.data!.chapterId, jobId: res.data!.jobId, series: series?.title ?? '', number: n, pages: pages.length, mode });
    setPhase('done');
    toast(mode === 'process' ? `Chapter ${chapterNo(n)} queued for processing` : `Chapter ${chapterNo(n)} is ready to publish`);
    router.refresh();
  };

  const publishNow = () => result && startPublish(async () => {
    const res = await publishUploadedAction(result.chapterId);
    if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
    setResult({ ...result, published: true });
    toast(`Chapter ${chapterNo(result.number)} published`);
  });

  const uploadZip = async () => {
    setErr('');
    if (!zip) return setErr('Choose a chapter ZIP file.');
    setPhase('saving');
    const body = new FormData();
    body.set('file', zip);
    body.set('seriesId', seriesId);
    body.set('number', num);
    body.set('title', title);
    try {
      const response = await fetch('/api/admin/chapters/ingest', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Chapter upload failed.');
      setResult({ chapterId: data.chapterId, jobId: data.jobId, series: series?.title ?? '', number: Number(num), pages: data.pageCount, mode: 'process' });
      setPhase('done');
      toast(`Chapter ${chapterNo(Number(num))} uploaded and queued`);
      router.refresh();
    } catch (error) {
      setPhase('form');
      setErr(error instanceof Error ? error.message : 'Chapter upload failed.');
    }
  };

  const reset = () => {
    setPhase('form'); setResult(null); setUrls(''); setTitle('');
    setZip(null);
    setNum(String((result?.number ?? 0) + 1));
  };

  const status: [string, string] = phase === 'form' ? ['WAITING FOR PAGES', 'neutral'] : phase === 'checking' ? ['CHECKING PAGES', 'ember'] : phase === 'saving' ? ['SAVING', 'ember']
    : result?.published ? ['PUBLISHED', 'success'] : result?.mode === 'process' ? ['QUEUED', 'neutral'] : ['READY', 'info'];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, alignItems: 'start' }}>
      <section className="a-section" style={{ padding: 'clamp(18px,3vw,24px)', gap: 18 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span style={{ font: '400 24px var(--serif)' }}>New chapter</span>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Add raw pages and queue them for OCR and translation, or add pages that are already translated.</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 14 }}>
          <label className="field" style={{ gridColumn: '1/-1', gap: 6 }}>
            <span className="label">Series</span>
            <select className="a-input" value={seriesId} disabled={locked} onChange={e => {
              const o = options.find(x => x.id === e.target.value);
              setSeriesId(e.target.value); setNum(String(o?.nextNumber ?? 1)); setSource(o?.sourceLanguage ?? 'ko');
            }}>
              {options.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </label>
          <label className="field" style={{ gap: 6 }}>
            <span className="label">Chapter number</span>
            <input className="a-input mono" inputMode="decimal" value={num} disabled={locked} onChange={e => setNum(e.target.value.replace(/[^0-9.]/g, ''))} />
            {series && Number(num) > 0 && Number(num) < series.nextNumber && <span style={{ fontSize: 12, color: 'var(--warning-text)' }}>This series already has chapters up to {series.nextNumber - 1}.</span>}
          </label>
          <label className="field" style={{ gap: 6 }}>
            <span className="label">Title <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>optional</span></span>
            <input className="a-input" value={title} disabled={locked} maxLength={200} placeholder="Chapter N" onChange={e => setTitle(e.target.value)} />
          </label>
          <label className="field" style={{ gap: 6 }}><span className="label">Source</span>
            <select className="a-input" value={source} disabled={locked || mode === 'direct'} onChange={e => setSource(e.target.value)}>
              {[...SOURCES, ...(SOURCES.some(s => s[0] === source) ? [] : [[source, source.toUpperCase()] as [string, string]])].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field" style={{ gap: 6 }}><span className="label">Target</span>
            <select className="a-input" value={target} disabled={locked || mode === 'direct'} onChange={e => setTarget(e.target.value)}>
              {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="field" style={{ gridColumn: '1/-1', gap: 6 }}>
            <span className="label">Pages</span>
            <Segmented h={34} stretch role="radio" label="Processing" options={[['process', 'Run OCR & translation'], ['direct', 'Already translated']]} value={mode} onChange={v => !locked && setMode(v)} />
          </div>
        </div>

        <div className="dropzone" style={{ cursor: 'default', alignItems: 'stretch', textAlign: 'left', padding: 14, gap: 8 }}>
          <span className="row" style={{ gap: 8, font: '600 14px var(--sans)' }}><Icon name="photo_library" size={20} color="var(--ink-2)" />Page image URLs</span>
          <textarea aria-label="Page image URLs" className="a-input mono" rows={6} disabled={locked} value={urls} onChange={e => setUrls(e.target.value)}
            placeholder={'https://cdn.example.com/ch12/001.webp\nhttps://cdn.example.com/ch12/002.webp'} style={{ height: 'auto', padding: '10px 12px', fontSize: 12, lineHeight: 1.6, resize: 'vertical' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>One https URL per line, in reading order · JPG, PNG or WEBP · up to 300 pages{list.length ? ` · ${list.length} added` : ''}</span>
        </div>
        <div className="dropzone" style={{ cursor: 'default', alignItems: 'stretch', textAlign: 'left', padding: 14, gap: 8 }}>
          <span className="row" style={{ gap: 8, font: '600 14px var(--sans)' }}><Icon name="folder_zip" size={20} color="var(--ink-2)" />Chapter ZIP</span>
          <input aria-label="Chapter ZIP file" className="a-input" type="file" accept=".zip,application/zip" disabled={locked} onChange={e => setZip(e.target.files?.[0] ?? null)} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>JPG, PNG, WEBP or AVIF pages · ordered by numbered filenames · up to 250 MB</span>
          <Button variant="secondary" h={40} fs={13} disabled={locked || !zip} loading={phase === 'saving'} onClick={uploadZip}>Validate, optimize and upload ZIP</Button>
        </div>
        {err && (
          <div role="alert" className="row" style={{ gap: 10, padding: 12, borderRadius: 10, background: 'rgba(229,103,92,.08)', border: '1px solid rgba(229,103,92,.25)', fontSize: 13, color: 'var(--danger-text)' }}>
            <Icon name="error" size={18} /><span style={{ wordBreak: 'break-all' }}>{err}</span>
          </div>
        )}
        <Button variant="primary" h={44} fs={14} disabled={locked} loading={phase === 'checking' || phase === 'saving'} onClick={start}>
          {phase === 'checking' ? `Checking pages ${checked}/${list.length}…` : phase === 'saving' ? 'Saving…' : phase === 'done' ? 'Uploaded' : mode === 'process' ? 'Upload and queue processing' : 'Upload pages'}
        </Button>
      </section>

      <section aria-live="polite" className="a-section" style={{ padding: 'clamp(18px,3vw,24px)', gap: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="stack" style={{ gap: 2 }}>
            <span style={{ font: '600 15px var(--sans)' }}>Processing status</span>
            <span className="meta">{result ? `${result.jobId ? `JOB-${result.jobId.slice(0, 8).toUpperCase()} · ` : ''}${result.series.toUpperCase()} · CH. ${chapterNo(result.number)}` : 'NO ACTIVE JOB'}</span>
          </div>
          <span className={`badge xs ${status[1]}`}>{status[0]}</span>
        </div>
        <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {PIPELINE_STAGE_ORDER.map((name, i) => {
            const direct = result?.mode === 'direct';
            // Direct translated uploads already contain delivery pages, so server validation hands them to review/publish.
            const skipped = direct && i > 2 && i < PIPELINE_STAGE_ORDER.length - 3;
            const done = !!result && direct && !skipped && (name === 'validating' || name === 'processing_images' || !!result.published);
            const active = !!result && !direct && i === 0;
            const readyStep = !!result && direct && name === 'ready' && !result.published;
            const color = done ? 'var(--success)' : active ? 'var(--ember)' : readyStep ? 'var(--info)' : 'var(--s4)';
            return (
              <li key={name} className="row" style={{ gap: 14, alignItems: 'stretch' }}>
                <div className="stack" style={{ alignItems: 'center', width: 22, flex: 'none' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: done ? color : readyStep ? 'rgba(134,169,222,.2)' : 'transparent', border: `1.5px solid ${color}`, color: 'var(--bg)' }}>
                    {done && <Icon name="check" size={14} style={{ fontWeight: 600 }} />}
                    {active && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ember)', animation: 'pulse 2s infinite' }} />}
                  </span>
                  {i < PIPELINE_STAGE_ORDER.length - 1 && <span style={{ flex: 1, width: 1.5, minHeight: 14, background: done ? 'var(--success)' : 'var(--s4)' }} />}
                </div>
                <div className="stack grow" style={{ gap: 6, padding: '1px 0 14px' }}>
                  <span style={{ font: '600 12px var(--mono)', letterSpacing: '.06em', color: done ? 'var(--success-text)' : active ? 'var(--ember-text)' : readyStep ? 'var(--info-text)' : 'var(--ink-4)' }}>{PIPELINE_STAGE_LABEL[name]}{skipped ? ' · SKIPPED' : ''}</span>
                  {active && <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>Queued. {PIPELINE_STAGE_DESC[name]} starts when a processing worker picks the job up.</span>}
                  {readyStep && <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{PIPELINE_STAGE_DESC.ready}</span>}
                </div>
              </li>
            );
          })}
        </ol>
        {result && !result.published && (
          <div className="stack" style={{ gap: 12, padding: 16, borderRadius: 12, background: result.mode === 'direct' ? 'rgba(123,201,160,.06)' : 'var(--s2)', border: `1px solid ${result.mode === 'direct' ? 'rgba(123,201,160,.22)' : 'var(--line-1)'}`, animation: 'pop .3s' }}>
            <span style={{ font: '600 14px var(--sans)' }}>{result.mode === 'direct' ? `${result.pages} pages saved · ready to publish` : `${result.pages} pages saved · waiting in the processing queue`}</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Link href={`/admin/chapters/${result.chapterId}`} className="btn btn-secondary" style={{ '--h': '40px', '--fs': '14px' } as React.CSSProperties}>Open chapter</Link>
              {result.mode === 'direct'
                ? <Button variant="primary" h={40} loading={publishing} onClick={publishNow}>Publish now</Button>
                : <Link href="/admin/processing?filter=active" className="btn btn-primary" style={{ '--h': '40px', '--fs': '14px', color: 'var(--bg)' } as React.CSSProperties}>View in processing</Link>}
              <Button variant="ghost" h={40} onClick={reset}>Upload another</Button>
            </div>
          </div>
        )}
        {result?.published && (
          <div className="row" style={{ gap: 12, padding: 16, borderRadius: 12, background: 'rgba(123,201,160,.08)', border: '1px solid rgba(123,201,160,.25)', animation: 'pop .3s' }}>
            <Icon name="check_circle" fill color="var(--success)" />
            <span className="grow" style={{ font: '600 14px var(--sans)' }}>Published. Followers are being notified.</span>
            <Button variant="outline" h={36} px={12} onClick={reset}>Upload another</Button>
          </div>
        )}
      </section>
    </div>
  );
}
