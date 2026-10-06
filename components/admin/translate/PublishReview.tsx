'use client';

import { Button, Icon } from '@/components/ui';
import { coverBg } from '@/lib/catalog';
import type { WorkspaceDTO, WorkspacePageDTO, WorkspaceSegmentDTO } from '@/server/data/manual-translation';

const stat = (label: string, value: number | string, tone?: string) => (
  <div key={label} className="a-card stack" style={{ padding: '12px 14px', borderRadius: 12, gap: 4 }}>
    <span style={{ font: '500 11px var(--mono)', color: 'var(--ink-3)' }}>{label}</span>
    <span style={{ font: '500 22px var(--mono)', color: tone }}>{value}</span>
  </div>
);

/** Final chapter review: what will ship, what still blocks publishing, and the publish button. */
export default function PublishReview({ data, pages, segments, evaluation, chapterStatus, busy, onPublish, onOpen, onAccept, onRetryRender }: {
  data: WorkspaceDTO; pages: WorkspacePageDTO[]; segments: WorkspaceSegmentDTO[]; evaluation: WorkspaceDTO['evaluation']; chapterStatus: string; busy: string | null;
  onPublish: () => void; onOpen: (pageIndex: number, segmentId?: string) => void; onAccept: (segmentId: string) => void; onRetryRender: (pageIds: string[]) => void;
}) {
  const review = segments.filter(s => s.typesetStatus === 'needs_review' || s.typesetStatus === 'failed');
  const failedPages = pages.filter(p => p.renderStatus === 'failed' || p.ocrStatus === 'failed');
  const published = chapterStatus === 'published';
  const canPublish = !published && evaluation.complete && chapterStatus === 'ready';
  const pageIndex = new Map(pages.map((p, i) => [p.id, i]));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ width: 84, aspectRatio: '3/4', borderRadius: 8, background: coverBg(data.series.coverHue, data.series.coverUrl), flex: 'none' }} />
        <div className="stack grow" style={{ gap: 6, minWidth: 220 }}>
          <span style={{ font: '400 22px var(--serif)' }}>{data.series.title} · Chapter {data.chapter.number}</span>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {published ? 'Published and visible to readers.' : canPublish ? 'Every page is translated and finalized.' : 'Publishing unlocks when every segment is translated, every page has its final image and nothing is blocking.'}
            {data.autoPublish && !published && ' Auto-publish is on: the chapter goes live as soon as it is complete.'}
          </span>
          {!!evaluation.blocking.length && !published && (
            <ul className="stack" style={{ gap: 4, margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--warning-text)' }}>
              {evaluation.blocking.map(reason => <li key={reason}>{reason}</li>)}
            </ul>
          )}
        </div>
        <Button variant="primary" h={44} icon="publish" disabled={!canPublish || busy === 'publish'} loading={busy === 'publish'} onClick={onPublish}
          title={canPublish ? 'Publish this chapter' : 'Resolve the blocking items first'}>{published ? 'Published' : 'Publish chapter'}</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
        {stat('PAGES', `${evaluation.pagesComplete}/${evaluation.pages}`, evaluation.pagesComplete === evaluation.pages ? 'var(--success-text)' : undefined)}
        {stat('TRANSLATED', evaluation.translated, 'var(--success-text)')}
        {stat('UNTRANSLATED', evaluation.remaining, evaluation.remaining ? 'var(--warning-text)' : undefined)}
        {stat('FAILED SEGMENTS', evaluation.failedSegments, evaluation.failedSegments ? 'var(--danger-text)' : undefined)}
        {stat('IMAGE REVIEW', evaluation.needsImageReview, evaluation.needsImageReview ? 'var(--warning-text)' : undefined)}
        {stat('PROGRESS', `${evaluation.percent}%`)}
      </div>
      {(review.length > 0 || failedPages.length > 0) && (
        <div className="a-card stack" style={{ padding: 14, gap: 8 }}>
          <span style={{ font: '600 14px var(--sans)' }}>Needs attention</span>
          {failedPages.map(p => (
            <div key={p.id} className="row" style={{ gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
              <Icon name="error" size={16} color="var(--danger)" />Page {p.pageNumber}: {p.ocrStatus === 'failed' ? `OCR failed${p.ocrError ? ` (${p.ocrError})` : ''}` : `final image failed${p.renderError ? ` (${p.renderError})` : ''}`}
              <span className="grow" />
              {p.renderStatus === 'failed' && <Button variant="secondary" h={28} onClick={() => onRetryRender([p.id])}>Retry image</Button>}
              <Button variant="ghost" h={28} onClick={() => onOpen(pageIndex.get(p.id) ?? 0)}>Open page</Button>
            </div>
          ))}
          {review.map(s => {
            const page = pages[pageIndex.get(s.pageId) ?? 0];
            return (
              <div key={s.id} className="row" style={{ gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
                <Icon name="image_search" size={16} color="var(--warning)" />Page {page?.pageNumber} · segment {s.position}: {s.qaFlags.join(', ').replaceAll('_', ' ') || s.typesetStatus}
                <span className="grow" />
                {s.typesetStatus === 'needs_review' && <Button variant="secondary" h={28} disabled={busy === s.id} onClick={() => onAccept(s.id)}>Looks good</Button>}
                <Button variant="ghost" h={28} onClick={() => onOpen(pageIndex.get(s.pageId) ?? 0, s.id)}>Fix</Button>
              </div>
            );
          })}
        </div>
      )}
      <span style={{ font: '600 14px var(--sans)' }}>Final pages</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
        {pages.map((p, i) => {
          const src = p.outputSrc ?? p.src;
          const current = p.renderedVersion >= p.editVersion && p.renderStatus !== 'failed';
          return (
            <button key={p.id} type="button" onClick={() => onOpen(i)} className="stack" style={{ gap: 4, padding: 0, background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ height: 220, overflow: 'hidden', borderRadius: 8, background: 'var(--s2)', border: `1px solid ${current ? 'var(--line-1)' : 'rgba(232,130,95,.4)'}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- final page preview from private storage */}
                {src && <img src={src} alt={`Final page ${p.pageNumber}`} loading="lazy" decoding="async" style={{ width: '100%', display: 'block' }} />}
              </div>
              <span style={{ font: '500 11px var(--mono)', color: 'var(--ink-3)' }}>P{p.pageNumber} · {p.outputSrc ? 'FINAL' : 'ORIGINAL'}{current ? '' : ' · RENDERING'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
