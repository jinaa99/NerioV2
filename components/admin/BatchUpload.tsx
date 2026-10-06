'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Button, Icon } from '@/components/ui';
import { chapterNo } from '@/lib/catalog';
import { chapterFromName, naturalCompare } from '@/lib/chapter-files';
import { batchStatus, type BatchStatus } from '@/lib/manual-translation';
import { retryBatchJobAction, startBatchJobsAction } from '@/server/actions/translate';
import { cancelJobAction } from '@/server/actions/admin';
import type { BatchChapterDTO } from '@/server/data/manual-translation';
import { useAdmin } from './store';

type SeriesOption = { id: string; title: string; sourceLanguage: string; nextNumber: number };
type Phase = 'QUEUED' | 'UPLOADING' | 'VALIDATING' | 'EXTRACTING' | 'SORTING' | 'PROCESSING' | 'STORING' | 'UPLOADED' | 'FAILED' | 'CANCELLED';
type Item = { key: string; file: File; number: string; phase: Phase; pct: number; detail?: string; error?: string; chapterId?: string; replayed?: boolean };
type ServerEvent = { type: 'progress'; phase: string; done: number; total: number } | { type: 'result'; chapterId: string; jobId: string; pageCount: number; replayed?: boolean } | { type: 'error'; error: string; code: string };

/** ZIPs uploaded at the same time; the rest wait so the server never unpacks an unbounded number at once. */
const UPLOAD_CONCURRENCY = 2;
const SOURCES: [string, string][] = [['en', 'English'], ['ko', 'Korean'], ['ja', 'Japanese'], ['zh', 'Chinese']];
const PHASE_OF: Record<string, Phase> = { validating: 'VALIDATING', extracting: 'EXTRACTING', sorting: 'SORTING', processing_images: 'PROCESSING', storing: 'STORING' };
const ACTIVE_UPLOAD: Phase[] = ['UPLOADING', 'VALIDATING', 'EXTRACTING', 'SORTING', 'PROCESSING', 'STORING'];
const TONE: Partial<Record<BatchStatus | Phase, string>> = {
  FAILED: 'danger', CANCELLED: 'neutral', COMPLETED: 'success', READY_TO_PUBLISH: 'info', UPLOADED: 'success',
  TRANSLATION_IN_PROGRESS: 'ember', TRANSLATION_COMPLETED: 'info', FINALIZATION: 'ember', OCR_PROCESSING: 'ember', QUEUED: 'neutral',
};
const LIVE: BatchStatus[] = ['QUEUED', 'VALIDATING', 'EXTRACTING', 'OCR_PROCESSING', 'FINALIZATION', 'TRANSLATION_COMPLETED'];

/** POST one ZIP with upload progress (XHR) and read the server's NDJSON progress stream as it arrives. */
function sendZip(form: FormData, onUpload: (pct: number) => void, onEvent: (event: ServerEvent) => void): { done: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  let offset = 0;
  const drain = (final: boolean) => {
    const text = xhr.responseText;
    let end = text.indexOf('\n', offset);
    while (end >= 0) {
      const line = text.slice(offset, end).trim(); offset = end + 1;
      if (line) { try { onEvent(JSON.parse(line)); } catch { /* partial or non-JSON line */ } }
      end = text.indexOf('\n', offset);
    }
    if (final && text.slice(offset).trim()) { try { onEvent(JSON.parse(text.slice(offset))); } catch { /* ignore */ } }
  };
  const done = new Promise<void>(resolve => {
    xhr.open('POST', '/api/admin/chapters/ingest');
    xhr.setRequestHeader('Accept', 'application/x-ndjson');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onUpload(Math.round((e.loaded / e.total) * 100)); };
    xhr.onprogress = () => drain(false);
    xhr.onload = () => {
      if (xhr.status === 200 && (xhr.getResponseHeader('content-type') ?? '').includes('ndjson')) drain(true);
      else {
        let message = `Upload failed (HTTP ${xhr.status}).`;
        try { message = JSON.parse(xhr.responseText).error ?? message; } catch { /* keep generic */ }
        onEvent({ type: 'error', error: message, code: String(xhr.status) });
      }
      resolve();
    };
    xhr.onerror = () => { onEvent({ type: 'error', error: 'Network error while uploading. Retry this ZIP.', code: 'network' }); resolve(); };
    xhr.onabort = () => resolve();
    xhr.send(form);
  });
  return { done, abort: () => xhr.abort() };
}

const pct = (n: number, d: number) => (d > 0 ? Math.floor((n / d) * 100) : 0);

function Meter({ value, label, tone = 'var(--ember)' }: { value: number; label: string; tone?: string }) {
  return (
    <div className="stack" style={{ gap: 4, minWidth: 90 }}>
      <span style={{ font: '500 11px var(--mono)', color: 'var(--ink-2)' }}>{label}</span>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--s4)', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, value)}%`, height: '100%', background: tone, transition: 'width .3s' }} /></div>
    </div>
  );
}

export default function BatchUpload({ options, rows, paused, autoPublish }: { options: SeriesOption[]; rows: BatchChapterDTO[]; paused: boolean; autoPublish: boolean }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const [seriesId, setSeriesId] = useState(options[0]?.id ?? '');
  const [source, setSource] = useState(options[0]?.sourceLanguage ?? 'en');
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const aborts = useRef(new Map<string, () => void>());
  const series = options.find(o => o.id === seriesId);

  const patch = useCallback((key: string, value: Partial<Item>) => setItems(list => list.map(item => item.key === key ? { ...item, ...value } : item)), []);

  const live = running || rows.some(row => LIVE.includes(statusOf(row)));
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [live, router]);

  const addFiles = (files: FileList | File[] | null) => {
    const chosen = [...(files ?? [])].filter(f => /\.(zip|cbz)$/i.test(f.name)).sort((a, b) => naturalCompare(a.name, b.name));
    if (!chosen.length) return toast('Choose .zip or .cbz chapter archives', 'error', 'var(--danger)');
    setItems(list => {
      const used = new Set(list.map(item => Number(item.number)));
      let next = series?.nextNumber ?? 1;
      const added = chosen.filter(file => !list.some(item => item.file.name === file.name && item.file.size === file.size)).map((file, i) => {
        let n = chapterFromName(file.name);
        if (n === null || !Number.isFinite(n) || used.has(n)) { while (used.has(next)) next++; n = next; }
        used.add(n);
        return { key: `${Date.now()}-${i}-${file.name}`, file, number: String(n), phase: 'QUEUED' as Phase, pct: 0 };
      });
      return [...list, ...added];
    });
  };

  const uploadOne = async (item: Item) => {
    const form = new FormData();
    form.set('file', item.file); form.set('seriesId', seriesId); form.set('number', item.number);
    form.set('sourceLanguage', source); form.set('targetLanguage', 'mn'); form.set('workflow', 'manual');
    patch(item.key, { phase: 'UPLOADING', pct: 0, error: undefined, detail: undefined });
    const request = sendZip(form, value => patch(item.key, { pct: value, ...(value >= 100 ? { phase: 'VALIDATING', pct: 0 } : {}) }), event => {
      if (event.type === 'progress') patch(item.key, { phase: PHASE_OF[event.phase] ?? 'PROCESSING', pct: pct(event.done, event.total), detail: event.total > 1 ? `${event.done}/${event.total}` : undefined });
      else if (event.type === 'result') patch(item.key, { phase: 'UPLOADED', pct: 100, chapterId: event.chapterId, replayed: event.replayed, detail: `${event.pageCount} pages` });
      else patch(item.key, { phase: 'FAILED', error: event.error });
    });
    aborts.current.set(item.key, request.abort);
    await request.done;
    aborts.current.delete(item.key);
  };

  const uploadAll = async () => {
    if (!seriesId) return toast('Choose a series first', 'error', 'var(--danger)');
    const todo = items.filter(item => item.phase === 'QUEUED' || item.phase === 'FAILED' || item.phase === 'CANCELLED');
    const numbers = items.map(item => Number(item.number));
    if (numbers.some(n => !Number.isFinite(n) || n < 0)) return toast('Every ZIP needs a chapter number', 'error', 'var(--danger)');
    if (new Set(numbers).size !== numbers.length) return toast('Two ZIP files have the same chapter number', 'error', 'var(--danger)');
    if (!todo.length) return;
    setRunning(true);
    let next = 0;
    // Each ZIP is its own request: a failure marks only that row and the others keep going.
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, todo.length) }, async () => {
      while (next < todo.length) await uploadOne(todo[next++]);
    }));
    setRunning(false);
    router.refresh();
  };

  const cancel = (item: Item) => {
    aborts.current.get(item.key)?.();
    patch(item.key, { phase: 'CANCELLED', error: undefined });
  };

  const act = (row: BatchChapterDTO, kind: 'retry' | 'start' | 'cancel') => {
    setBusy(row.jobId);
    startTransition(async () => {
      const res = kind === 'retry' ? await retryBatchJobAction(row.jobId) : kind === 'start' ? await startBatchJobsAction([row.jobId]) : await cancelJobAction(row.jobId);
      setBusy(null);
      if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
      toast(kind === 'cancel' ? 'OCR cancelled' : 'OCR queued', kind === 'cancel' ? 'block' : 'refresh', 'var(--info)');
      router.refresh();
    });
  };

  if (options.length === 0) {
    return (
      <div className="a-card stack" style={{ padding: 48, alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <Icon name="collections_bookmark" size={28} color="var(--ink-3)" />
        <span style={{ font: '600 15px var(--sans)' }}>Create a series first</span>
        <Link href="/admin/series/new" className="btn btn-primary" style={{ '--h': '36px', '--fs': '13px', color: 'var(--bg)' } as React.CSSProperties}>New series</Link>
      </div>
    );
  }

  const pendingUploads = items.filter(item => item.phase === 'QUEUED' || item.phase === 'FAILED' || item.phase === 'CANCELLED').length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="a-section" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span style={{ font: '400 24px var(--serif)' }}>Batch upload</span>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            One ZIP per chapter. Pages are extracted and sorted on the server, OCR runs automatically, then you translate every segment by hand in the workspace.
            No translation API is called. {autoPublish ? 'Finished chapters publish automatically.' : 'Finished chapters wait for your final review.'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
          <label className="field" style={{ gap: 6 }}>
            <span className="label">Series</span>
            <select className="a-input" value={seriesId} disabled={running} onChange={e => { const o = options.find(x => x.id === e.target.value); setSeriesId(e.target.value); setSource(o?.sourceLanguage ?? source); }}>
              {options.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </label>
          <label className="field" style={{ gap: 6 }}>
            <span className="label">Source language (OCR)</span>
            <select className="a-input" value={source} disabled={running} onChange={e => setSource(e.target.value)}>
              {[...SOURCES, ...(SOURCES.some(s => s[0] === source) ? [] : [[source, source.toUpperCase()] as [string, string]])].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <label className={`dropzone ${drag ? 'drag' : ''}`} style={{ padding: 22, gap: 8, cursor: 'pointer' }}
          onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
          <Icon name="folder_zip" size={26} color="var(--ink-2)" />
          <span style={{ font: '600 14px var(--sans)' }}>Upload ZIP files</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Drop or choose many chapter ZIPs at once · chapter numbers are read from file names · JPG, PNG, WEBP, AVIF, GIF, TIFF pages</span>
          <input type="file" multiple accept=".zip,.cbz,application/zip" aria-label="Chapter ZIP files" style={{ display: 'none' }} disabled={running} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        </label>
        {items.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            {items.map(item => {
              const active = ACTIVE_UPLOAD.includes(item.phase);
              return (
                <div key={item.key} className="row" style={{ gap: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--s2)', fontSize: 12, flexWrap: 'wrap' }}>
                  <Icon name="folder_zip" size={16} color="var(--ink-3)" />
                  <span className="ellipsis" style={{ flex: '1 1 180px', minWidth: 0 }} title={item.file.name}>{item.file.name} <span style={{ color: 'var(--ink-4)' }}>· {(item.file.size / 1048576).toFixed(1)} MB</span></span>
                  <label className="row" style={{ gap: 4 }}>Ch.
                    <input aria-label={`Chapter number for ${item.file.name}`} className="a-input mono" inputMode="decimal" value={item.number} disabled={running || item.phase === 'UPLOADED'}
                      onChange={e => patch(item.key, { number: e.target.value.replace(/[^0-9.]/g, '') })} style={{ width: 70, height: 28, fontSize: 12 }} />
                  </label>
                  {active && <div style={{ width: 120 }}><Meter value={item.pct} label={`${item.phase}${item.detail ? ` ${item.detail}` : ` ${item.pct}%`}`} /></div>}
                  {!active && <span className={`badge xs ${TONE[item.phase] ?? 'neutral'}`}>{item.phase === 'UPLOADED' ? `OCR QUEUED · ${item.detail ?? ''}${item.replayed ? ' · ALREADY UPLOADED' : ''}` : item.phase}</span>}
                  {active && <Button variant="ghost" h={28} onClick={() => cancel(item)}>Cancel</Button>}
                  {!active && item.phase !== 'UPLOADED' && !running && <Button variant="ghost" h={28} onClick={() => setItems(list => list.filter(x => x.key !== item.key))}>Remove</Button>}
                  {item.chapterId && <Link href={`/admin/translate/${item.chapterId}`} style={{ color: 'var(--ember-text)' }}>Open</Link>}
                  {item.error && <span style={{ flexBasis: '100%', color: 'var(--danger-text)' }}>{item.error}</span>}
                </div>
              );
            })}
          </div>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" h={40} icon="upload" disabled={!pendingUploads || running} loading={running} onClick={uploadAll}>
            {running ? 'Uploading…' : items.some(item => item.phase === 'FAILED') ? `Retry ${pendingUploads} ZIP${pendingUploads === 1 ? '' : 's'}` : `Upload ${pendingUploads || ''} ZIP${pendingUploads === 1 ? '' : 's'}`}
          </Button>
          {items.some(item => item.phase === 'UPLOADED') && !running && <Button variant="ghost" h={40} onClick={() => setItems(list => list.filter(item => item.phase !== 'UPLOADED'))}>Clear uploaded</Button>}
          {paused && <span style={{ fontSize: 12, color: 'var(--warning-text)' }}>The pipeline is paused in Settings: uploads are kept, OCR starts when it is resumed.</span>}
        </div>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ font: '600 15px var(--sans)' }}>Batch jobs</span>
          <span className="meta" style={{ marginLeft: 'auto' }}>{rows.length} CHAPTER{rows.length === 1 ? '' : 'S'}{live ? ' · UPDATING' : ''}</span>
        </div>
        {rows.length === 0
          ? <div className="a-card" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)' }}>No chapters uploaded for manual translation yet.</div>
          : (
            <div className="a-table-wrap">
              <table className="a-table">
                <thead><tr><th>CHAPTER</th><th>OCR</th><th>TRANSLATION</th><th>FINALIZATION</th><th>STATUS</th><th /></tr></thead>
                <tbody>
                  {rows.map(row => {
                    const status = statusOf(row);
                    const ocrPct = row.job.status === 'running' ? row.job.stageProgress : pct(row.ocrDone, row.pages);
                    return (
                      <tr key={row.jobId}>
                        <td style={{ minWidth: 200 }}>
                          <Link href={`/admin/translate/${row.chapterId}`} style={{ font: '600 13px var(--sans)', color: 'var(--ink-1)' }}>{row.series.title} · Ch. {chapterNo(row.chapterNumber)}</Link>
                          <div style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }} className="ellipsis">{row.filename ?? '—'} · {row.pages} PAGES</div>
                          {row.job.errorMessage && (row.job.status === 'failed') && <div style={{ fontSize: 11, color: 'var(--danger-text)', maxWidth: 360 }}>{row.job.errorMessage}</div>}
                        </td>
                        <td><Meter value={ocrPct} label={row.ocrFailed ? `${row.ocrDone}/${row.pages} · ${row.ocrFailed} FAILED` : row.ocrDone === row.pages ? 'COMPLETE' : row.job.status === 'queued' ? 'WAITING' : `${ocrPct}%`} tone={row.ocrFailed ? 'var(--danger)' : row.ocrDone === row.pages ? 'var(--success)' : 'var(--ember)'} /></td>
                        <td><Meter value={pct(row.translated, row.segments)} label={row.ocrDone < row.pages && !row.segments ? 'WAITING' : `${row.translated}/${row.segments} · ${row.segments ? pct(row.translated, row.segments) : 100}%`} tone={row.segments && row.translated === row.segments ? 'var(--success)' : 'var(--info)'} /></td>
                        <td><Meter value={pct(row.pagesFinal, row.pages)} label={`${row.pagesFinal}/${row.pages} PAGES${row.needsReview ? ` · ${row.needsReview} REVIEW` : ''}`} tone={row.pagesFinal === row.pages ? 'var(--success)' : 'var(--ember)'} /></td>
                        <td><span className={`badge xs ${TONE[status] ?? 'neutral'}`}>{status.replaceAll('_', ' ')}</span></td>
                        <td>
                          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            {row.job.status === 'failed' && <Button variant="secondary" h={30} icon="refresh" loading={busy === row.jobId} disabled={paused} onClick={() => act(row, 'retry')}>Retry OCR</Button>}
                            {row.job.status === 'queued' && <Button variant="ghost" h={30} loading={busy === row.jobId} disabled={paused} onClick={() => act(row, 'start')}>Start</Button>}
                            {(row.job.status === 'queued' || row.job.status === 'running') && <Button variant="ghost" h={30} onClick={() => { if (confirm('Cancel OCR for this chapter?')) act(row, 'cancel'); }}>Cancel</Button>}
                            {status === 'READY_TO_PUBLISH' && <Link href={`/admin/translate/${row.chapterId}?mode=publish`} className="btn btn-primary" style={{ '--h': '30px', '--px': '10px', '--fs': '12px', color: 'var(--bg)' } as React.CSSProperties}>Review &amp; publish</Link>}
                            {row.job.status !== 'queued' && row.job.status !== 'running' && status !== 'READY_TO_PUBLISH' && <Link href={`/admin/translate/${row.chapterId}`} className="btn btn-secondary" style={{ '--h': '30px', '--px': '10px', '--fs': '12px' } as React.CSSProperties}>{status === 'COMPLETED' ? 'View' : 'Translate'}</Link>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}

function statusOf(row: BatchChapterDTO): BatchStatus {
  return batchStatus(row.job, row.chapterStatus, {
    segments: row.segments, translated: row.translated, drafts: row.drafts, remaining: row.segments - row.translated,
    complete: row.pages > 0 && row.ocrDone === row.pages && row.pagesFinal === row.pages && row.needsReview === 0,
  });
}
