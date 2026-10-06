'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { WorkspacePageDTO, WorkspaceSegmentDTO } from '@/server/data/manual-translation';

export type Box = { x: number; y: number; w: number; h: number };
type Drag = { id: string; mode: 'move' | 'nw' | 'se'; startX: number; startY: number; start: Box; rect: DOMRect };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN = 0.004;

function moved(drag: Drag, clientX: number, clientY: number): Box {
  const dx = (clientX - drag.startX) / drag.rect.width, dy = (clientY - drag.startY) / drag.rect.height;
  const b = drag.start;
  if (drag.mode === 'move') return { ...b, x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h) };
  if (drag.mode === 'se') return { ...b, w: clamp(b.w + dx, MIN, 1 - b.x), h: clamp(b.h + dy, MIN, 1 - b.y) };
  const x = clamp(b.x + dx, 0, b.x + b.w - MIN), y = clamp(b.y + dy, 0, b.y + b.h - MIN);
  return { x, y, w: b.x + b.w - x, h: b.y + b.h - y };
}

/**
 * One page image with its text regions. Regions are positioned in page fractions, so the overlay is exact at any
 * display size. When `editable`, the selected region can be dragged and resized; in `drawing` mode a new region is
 * drawn by dragging on the image.
 */
export default function PageCanvas({ page, src, segments, selectedId, onSelect, editable, drawing, showBoxes, onBoxChange, onDraw, label, note }: {
  page: WorkspacePageDTO; src: string | null; segments: WorkspaceSegmentDTO[]; selectedId: string | null; onSelect: (id: string) => void;
  editable: boolean; drawing: boolean; showBoxes: boolean; onBoxChange: (id: string, box: Box) => void; onDraw: (box: Box) => void; label: string; note?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Box | null>(null);
  const [draw, setDraw] = useState<{ x0: number; y0: number; box: Box } | null>(null);

  const startDrag = (e: ReactPointerEvent, segment: WorkspaceSegmentDTO, mode: Drag['mode']) => {
    if (!editable || !ref.current) return;
    e.stopPropagation(); e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const start = { x: segment.x, y: segment.y, w: segment.w, h: segment.h };
    setDrag({ id: segment.id, mode, startX: e.clientX, startY: e.clientY, start, rect: ref.current.getBoundingClientRect() });
    setPreview(start);
    onSelect(segment.id);
  };
  const point = (e: ReactPointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width, 0, 1), y: clamp((e.clientY - rect.top) / rect.height, 0, 1) };
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="row" style={{ gap: 8, font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>{label}{note && <span style={{ color: 'var(--warning-text)' }}>{note}</span>}</span>
      <div ref={ref} style={{ position: 'relative', aspectRatio: `${page.width}/${page.height}`, background: 'var(--s2)', borderRadius: 8, overflow: 'hidden', cursor: drawing ? 'crosshair' : undefined, touchAction: drawing || drag ? 'none' : undefined, userSelect: 'none' }}
        onPointerDown={e => {
          if (!drawing || !ref.current) return;
          (e.target as Element).setPointerCapture(e.pointerId);
          const p = point(e); setDraw({ x0: p.x, y0: p.y, box: { x: p.x, y: p.y, w: 0, h: 0 } });
        }}
        onPointerMove={e => {
          if (drag) setPreview(moved(drag, e.clientX, e.clientY));
          else if (draw) { const p = point(e); setDraw({ ...draw, box: { x: Math.min(draw.x0, p.x), y: Math.min(draw.y0, p.y), w: Math.abs(p.x - draw.x0), h: Math.abs(p.y - draw.y0) } }); }
        }}
        onPointerUp={e => {
          if (drag) {
            const box = moved(drag, e.clientX, e.clientY);
            const changed = Math.abs(box.x - drag.start.x) + Math.abs(box.y - drag.start.y) + Math.abs(box.w - drag.start.w) + Math.abs(box.h - drag.start.h) > 0.0005;
            setDrag(null); setPreview(null);
            if (changed) onBoxChange(drag.id, box);
          } else if (draw) {
            setDraw(null);
            if (draw.box.w > MIN && draw.box.h > MIN) onDraw(draw.box);
          }
        }}>
        {src
          // eslint-disable-next-line @next/next/no-img-element -- private page image from storage, shown as-is
          ? <img src={src} alt={`Page ${page.pageNumber}`} draggable={false} decoding="async" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
          : <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink-4)' }}>No image</div>}
        {showBoxes && segments.map(segment => {
          const selected = segment.id === selectedId;
          const b = selected && drag?.id === segment.id && preview ? preview : segment;
          const done = segment.translationStatus === 'translated' || segment.translationStatus === 'approved';
          const color = segment.typesetStatus === 'needs_review' || segment.typesetStatus === 'failed' ? 'var(--danger)' : done ? 'var(--success)' : segment.translationStatus === 'draft' ? 'var(--warning)' : 'var(--info)';
          return (
            <div key={segment.id} data-segment-box={segment.id}
              style={{ position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
                border: selected ? '2px solid var(--ember)' : `1.5px dashed ${color}`, background: selected ? 'rgba(232,130,95,.10)' : 'transparent', borderRadius: 4,
                cursor: editable && selected ? 'move' : 'pointer', pointerEvents: drawing ? 'none' : undefined }}
              onPointerDown={e => { if (editable && selected) startDrag(e, segment, 'move'); }}
              onClick={e => { e.stopPropagation(); onSelect(segment.id); }}>
              <span style={{ position: 'absolute', top: -9, left: -9, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: selected ? 'var(--ember)' : color, color: 'var(--bg)', font: '600 10px var(--mono)', display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>{segment.position}</span>
              {editable && selected && <>
                <span aria-hidden onPointerDown={e => startDrag(e, segment, 'nw')} style={{ position: 'absolute', left: -6, top: -6, width: 12, height: 12, borderRadius: 3, background: 'var(--ember)', cursor: 'nwse-resize' }} />
                <span aria-hidden onPointerDown={e => startDrag(e, segment, 'se')} style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, borderRadius: 3, background: 'var(--ember)', cursor: 'nwse-resize' }} />
              </>}
            </div>
          );
        })}
        {draw && <div style={{ position: 'absolute', left: `${draw.box.x * 100}%`, top: `${draw.box.y * 100}%`, width: `${draw.box.w * 100}%`, height: `${draw.box.h * 100}%`, border: '2px solid var(--ember)', background: 'rgba(232,130,95,.12)' }} />}
      </div>
    </div>
  );
}
