'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Icon, IconButton, Segmented } from '@/components/ui';
import { chapterNo } from '@/lib/catalog';
import { approvePageAction, publishReviewedAction, reviewSegmentAction, sendBackAction } from '@/server/actions/admin';
import type { ReviewJobDTO, ReviewSegmentDTO } from '@/server/data/pipeline';
import { confColors } from './pipeline-ui';
import { useAdmin } from './store';

type State = ReviewSegmentDTO['reviewStatus'];
const STATE_TONE: Record<State, string> = { approved: 'success', pending: 'neutral', flagged: 'danger', edited: 'info' };
const STATE_LABEL: Record<State, string> = { approved: 'APPROVED', pending: 'PENDING', flagged: 'FLAGGED', edited: 'EDITED' };
const resolved = (s: State) => s === 'approved' || s === 'edited';

export default function Review({ job }: { job: ReviewJobDTO }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const editable = job.jobStatus === 'ready' && job.chapter.status === 'in_review';
  const [segments, setSegments] = useState(job.segments);
  const firstOpen = segments.find(s => !resolved(s.reviewStatus));
  const [pageIdx, setPageIdx] = useState(() => Math.max(0, job.pages.findIndex(p => p.id === firstOpen?.pageId)));
  const [view, setView] = useState<0 | 1 | 2>(0);
  const [boxes, setBoxes] = useState(true);
  const [sel, setSel] = useState<string | null>(firstOpen?.id ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const page = job.pages[pageIdx];
  const onPage = segments.filter(s => s.pageId === page?.id);
  const totalResolved = segments.filter(s => resolved(s.reviewStatus)).length;
  const pageResolved = onPage.filter(s => resolved(s.reviewStatus)).length;
  const flagged = segments.filter(s => s.reviewStatus === 'flagged').length;
  const canPublish = editable && segments.length > 0 && totalResolved === segments.length;
  const minConf = onPage.reduce<number | null>((m, s) => (s.confidence === null ? m : m === null ? s.confidence : Math.min(m, s.confidence)), null);
  const nextOpenPage = () => {
    const idx = job.pages.findIndex((p, i) => i > pageIdx && segments.some(s => s.pageId === p.id && !resolved(s.reviewStatus)));
    return idx === -1 ? null : idx;
  };

  const update = (seg: ReviewSegmentDTO, reviewStatus: 'approved' | 'edited' | 'flagged', translatedText?: string) => {
    setBusy(seg.id);
    startTransition(async () => {
      const res = await reviewSegmentAction({ segmentId: seg.id, reviewStatus, ...(translatedText !== undefined ? { translatedText } : {}) });
      setBusy(null);
      if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
      setSegments(list => list.map(s => (s.id === seg.id ? { ...s, reviewStatus, translatedText: translatedText ?? s.translatedText } : s)));
      if (reviewStatus === 'edited') router.refresh();
      if (res.data?.visualFlags?.length) toast(`Text saved, but page QA still flags: ${res.data.visualFlags.join(', ')}`, 'error', 'var(--danger)');
      else if (reviewStatus === 'edited') toast('Text corrected and page re-rendered');
      setEditing(null);
      if (reviewStatus === 'flagged') toast(`Region ${seg.position} flagged for re-translation`, 'replay', 'var(--warning)');
      // Move to the next open region on this page.
      const next = onPage.find(s => s.id !== seg.id && !resolved(s.reviewStatus) && s.reviewStatus !== 'flagged');
      if (next) setSel(next.id);
    });
  };

  const approveThisPage = () => startTransition(async () => {
    const res = await approvePageAction(job.jobId, page.pageNumber);
    if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
    setSegments(list => list.map(s => (s.pageId === page.id && s.reviewStatus === 'pending' ? { ...s, reviewStatus: 'approved' } : s)));
    toast(`Page ${page.pageNumber} approved`);
    const n = nextOpenPage();
    if (n !== null) setPageIdx(n);
  });

  const sendBackChapter = () => {
    const note = prompt('What needs to change? (sent with the job, optional)');
    if (note === null) return;
    startTransition(async () => {
      const res = await sendBackAction(job.jobId, note);
      if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
      toast(`Chapter ${chapterNo(job.chapter.number)} sent back to translation`, 'replay', 'var(--warning)');
      router.push('/admin/queue');
    });
  };

  const publish = () => startTransition(async () => {
    const res = await publishReviewedAction(job.jobId);
    if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
    toast(`Chapter ${chapterNo(job.chapter.number)} published · followers notified`);
    router.push('/admin/queue');
  });

  if (!page) {
    return <div className="a-card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>This chapter has no pages.</div>;
  }

  const panes = [
    { label: `ORIGINAL · ${job.sourceLanguage.toUpperCase()}`, translated: false },
    { label: `TRANSLATED · ${job.targetLanguage.toUpperCase()}`, translated: true },
  ];
  const shown = view === 0 ? panes : [panes[view - 1]];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Link href="/admin/queue" className="btn btn-ghost" style={{ '--h': '36px', '--px': '10px', '--fs': '13px', gap: 6 } as React.CSSProperties}><Icon name="arrow_back" size={18} />Queue</Link>
        <span style={{ font: '600 15px var(--sans)' }}>{job.series.title} · Ch. {chapterNo(job.chapter.number)}</span>
        <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
          <IconButton icon="chevron_left" label="Previous page" h={34} r={8} variant="boxed" iconSize={18} disabled={pageIdx === 0} onClick={() => setPageIdx(i => Math.max(0, i - 1))} />
          <span style={{ font: '500 12px var(--mono)', padding: '0 8px', color: 'var(--ink-2)' }}>PAGE {page.pageNumber} / {job.pages.length}</span>
          <IconButton icon="chevron_right" label="Next page" h={34} r={8} variant="boxed" iconSize={18} disabled={pageIdx === job.pages.length - 1} onClick={() => setPageIdx(i => Math.min(job.pages.length - 1, i + 1))} />
        </div>
      </div>
      {!editable && (
        <div className="row" style={{ gap: 10, padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(230,194,106,.3)', background: 'rgba(230,194,106,.06)', fontSize: 13, color: 'var(--warning-text)' }}>
          <Icon name="lock" size={18} />This chapter isn’t waiting for review anymore ({job.chapter.status.replace('_', ' ')}), so it’s read-only.
        </div>
      )}
      {!!page.visualQaFlags.length && <div className="row" role="alert" style={{ gap: 8, padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(229,103,92,.3)', background: 'rgba(229,103,92,.07)', fontSize: 12, color: 'var(--danger-text)' }}><Icon name="warning" size={18} />Visual QA: {page.visualQaFlags.join(', ')}. Critical failures block publishing; send the chapter back after configuring image cleanup or correcting the text.</div>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Segmented h={30} options={[[0, 'Side by side'], [1, 'Original'], [2, 'Translated']]} value={view} onChange={v => setView(v as 0 | 1 | 2)} />
        <Button variant="outline" h={36} px={10} fs={12} icon="select_all" aria-pressed={boxes} onClick={() => setBoxes(b => !b)}
          style={{ background: boxes ? 'rgba(232,130,95,.12)' : 'var(--s2)', borderColor: 'rgba(255,255,255,.1)' }}>Text regions</Button>
        <span className="meta" style={{ marginLeft: 'auto' }}>{onPage.length} REGIONS · {onPage.filter(s => s.warning).length} WARNINGS{minConf !== null ? ` · MIN ${minConf.toFixed(2)}` : ''}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,520px),1fr))', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 12 }}>
          {shown.map(pane => (
            <div key={pane.label} className="stack" style={{ gap: 8 }}>
              <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>{pane.label}</span>
              <div style={{ position: 'relative', aspectRatio: `${page.width}/${page.height}`, borderRadius: 10, overflow: 'hidden', background: 'var(--s2)', border: '1px solid rgba(255,255,255,.08)' }}>
                {(pane.translated ? page.outputSrc ?? page.src : page.src)
                  // eslint-disable-next-line @next/next/no-img-element -- original page from storage/URL, shown as-is
                  ? <img src={pane.translated ? page.outputSrc ?? page.src! : page.src!} alt={`Page ${page.pageNumber}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
                  : <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink-4)' }}><Icon name="hide_image" /></div>}
                {onPage.map(s => {
                  const [c] = confColors(s.translationConfidence ?? s.confidence ?? 0);
                  const isSel = sel === s.id;
                  const text = editing === s.id ? draft : s.translatedText ?? '';
                  if ((!pane.translated && !boxes) || (pane.translated && page.outputSrc)) return null;
                  return (
                    <div key={s.id} style={{ position: 'absolute', left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }}>
                      <button type="button" aria-label={`Region ${s.position}`} className="region-btn" onClick={() => setSel(s.id)}
                        style={{
                          background: pane.translated ? 'rgba(250,248,244,.94)' : 'transparent',
                          border: boxes ? (isSel ? '2px solid var(--ember)' : `1.5px dashed ${c}`) : '1px solid rgba(0,0,0,.1)',
                          font: '600 clamp(8px,1vw,12px) var(--sans)',
                        }}>
                        {pane.translated ? text : ''}
                      </button>
                      {boxes && (
                        <span style={{ position: 'absolute', top: -7, left: -7, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: isSel ? 'var(--ember)' : c, color: 'var(--bg)', font: '600 10px var(--mono)', display: 'grid', placeItems: 'center', pointerEvents: 'none', boxShadow: '0 0 0 2px rgba(11,11,13,.6)' }}>{s.position}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="stack" style={{ gap: 10 }}>
          {onPage.length === 0 && <div className="a-card" style={{ padding: 24, color: 'var(--ink-3)', fontSize: 13 }}>No text regions were detected on this page.</div>}
          {onPage.map(s => {
            const [c, ct] = confColors(s.translationConfidence ?? s.confidence ?? 0);
            const isSel = sel === s.id, isEditing = editing === s.id;
            return (
              <div key={s.id} onClick={() => setSel(s.id)} className="stack" style={{ padding: 14, borderRadius: 14, background: 'var(--s1)', border: `1px solid ${isSel ? 'rgba(232,130,95,.5)' : 'var(--line-1)'}`, gap: 10, cursor: 'pointer', transition: 'border-color .2s', opacity: busy === s.id ? .6 : 1 }}>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: isSel ? 'var(--ember)' : c, color: 'var(--bg)', font: '600 11px var(--mono)', display: 'grid', placeItems: 'center' }}>{s.position}</span>
                  <span style={{ font: '500 11px var(--mono)', color: 'var(--ink-3)' }}>{s.kind.toUpperCase()}</span>
                  {s.confidence !== null && (
                    <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
                      <div style={{ width: 56, height: 4, borderRadius: 2, background: 'var(--s4)' }}><div style={{ width: `${s.confidence * 100}%`, height: '100%', borderRadius: 2, background: c }} /></div>
                      <span style={{ font: '500 12px var(--mono)', color: ct }}>{s.confidence.toFixed(2)}</span>
                    </div>
                  )}
                  <span className={`badge xs ${STATE_TONE[s.reviewStatus]}`} style={{ marginLeft: s.confidence === null ? 'auto' : undefined }}>{STATE_LABEL[s.reviewStatus]}</span>
                </div>
                {s.warning && <div className="row" style={{ gap: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(230,194,106,.08)', fontSize: 12, color: 'var(--warning-text)', alignItems: 'flex-start' }}><Icon name="warning" size={16} />{s.warning}</div>}
                <span style={{ font: '400 10px var(--mono)', color: 'var(--ink-3)' }}>OCR {s.ocrConfidence?.toFixed(2) ?? '—'} · TRANSLATION {s.translationConfidence?.toFixed(2) ?? '—'} · {s.processingStatus.toUpperCase()}</span>
                <div style={{ font: '500 14px/1.5 var(--kr)', color: 'var(--ink-2)' }}>{s.sourceText}</div>
                {isEditing
                  ? <textarea aria-label={`Translation for region ${s.position}`} value={draft} onClick={e => e.stopPropagation()} autoFocus maxLength={2000}
                      onChange={e => setDraft(e.target.value)}
                      style={{ minHeight: 72, resize: 'vertical', padding: '10px 12px', borderRadius: 9, background: 'var(--s2)', border: '1px solid var(--ember)', color: 'var(--ink-1)', font: '400 14px/1.5 var(--sans)', outline: 'none', boxShadow: '0 0 0 3px rgba(232,130,95,.15)' }} />
                  : <div style={{ font: '400 15px/1.5 var(--sans)', color: s.translatedText ? undefined : 'var(--ink-4)' }}>{s.translatedText ?? 'No translation yet'}</div>}
                {editable && (
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {isEditing ? <>
                      <Button variant="secondary" h={32} icon="done" disabled={!draft.trim() || busy === s.id} onClick={e => { e.stopPropagation(); update(s, draft.trim() === (s.translatedText ?? '') ? 'approved' : 'edited', draft.trim()); }}>Save</Button>
                      <Button variant="ghost" h={32} onClick={e => { e.stopPropagation(); setEditing(null); }}>Cancel</Button>
                    </> : <Button variant="secondary" h={32} icon="edit" onClick={e => { e.stopPropagation(); setEditing(s.id); setDraft(s.translatedText ?? ''); setSel(s.id); }}>Edit</Button>}
                    <Button variant="success" h={32} icon="check" disabled={busy === s.id || !s.translatedText || s.reviewStatus === 'approved'} onClick={e => { e.stopPropagation(); update(s, 'approved'); }}>Approve</Button>
                    <Button variant="danger" h={32} icon="close" disabled={busy === s.id || s.reviewStatus === 'flagged'} onClick={e => { e.stopPropagation(); update(s, 'flagged'); }}>Reject</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {editable && (
        <div className="row" style={{ position: 'sticky', bottom: 12, zIndex: 10, gap: 10, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 14, background: 'rgba(23,23,27,.96)', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 20px 50px -16px rgba(0,0,0,.9)' }}>
          <div className="stack" style={{ flex: '1 1 200px', gap: 6 }}>
            <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-2)' }}>
              {pageResolved} OF {onPage.length} ON THIS PAGE · {totalResolved} OF {segments.length} IN CHAPTER{flagged ? ` · ${flagged} FLAGGED` : ''}
            </span>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--s4)', overflow: 'hidden' }}><div style={{ width: `${segments.length ? (totalResolved / segments.length) * 100 : 0}%`, height: '100%', background: 'var(--success)', transition: 'width .3s' }} /></div>
          </div>
          <Button variant="secondary" h={40} disabled={pending || onPage.every(s => s.reviewStatus !== 'pending')} onClick={approveThisPage}>Approve page</Button>
          <Button variant="danger" h={40} disabled={pending} style={{ background: 'transparent', borderColor: 'rgba(229,103,92,.3)' }} onClick={sendBackChapter}>Send back</Button>
          <Button variant="primary" h={40} icon="publish" disabled={!canPublish || pending} loading={pending && canPublish}
            title={canPublish ? `Publish chapter ${chapterNo(job.chapter.number)}` : 'Approve every region to publish'} onClick={publish}>Publish chapter</Button>
        </div>
      )}
    </div>
  );
}
