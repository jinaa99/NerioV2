'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, Icon, IconButton, Segmented } from '@/components/ui';
import { chapterNo } from '@/lib/catalog';
import { formatPageText, isTranslated, nextUntranslated, pageComplete, parseBulkTranslation, type PageState } from '@/lib/manual-translation';
import type { TypesetStyleOverride } from '@/lib/typeset-style';
import {
  acceptSegmentImageAction, addSegmentAction, approveSegmentsAction, correctSourceTextAction, deleteSegmentAction, moveSegmentAction,
  publishManualChapterAction, retryPageOcrAction, retryPageRenderAction, saveDraftAction, saveTranslationsAction, updateSegmentLayoutAction, workspaceStatusAction,
} from '@/server/actions/translate';
import type { WorkspaceDTO, WorkspacePageDTO, WorkspaceSegmentDTO } from '@/server/data/manual-translation';
import { useAdmin } from '../store';
import PageCanvas, { type Box } from './PageCanvas';
import PublishReview from './PublishReview';
import StylePanel from './StylePanel';

type Mode = 'translate' | 'ocr' | 'publish';
type View = 'original' | 'translated' | 'split';
type SaveState = 'dirty' | 'saving' | 'saved' | 'error';

const BACKUP = (id: string) => `nerio-draft:${id}`;
const POSITION = (chapterId: string) => `nerio-workspace:${chapterId}`;
const AUTOSAVE_MS = 800;
const storage = {
  get(key: string) { try { return window.localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { window.localStorage.setItem(key, value); } catch { /* storage full or blocked */ } },
  remove(key: string) { try { window.localStorage.removeItem(key); } catch { /* ignore */ } },
};
const sourceOf = (s: WorkspaceSegmentDTO) => s.correctedSourceText ?? s.sourceText;
const isField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy'); area.remove(); return ok;
  }
}

export default function Workspace({ data, initialMode }: { data: WorkspaceDTO; initialMode: Mode }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const chapterId = data.chapter.id;

  // Server truth, re-synced whenever the server component sends fresh data (router.refresh()).
  const [synced, setSynced] = useState(data);
  const [pages, setPages] = useState(data.pages);
  const [segments, setSegments] = useState(data.segments);
  const [chapterStatus, setChapterStatus] = useState(data.chapter.status);
  const [job, setJob] = useState(data.job);
  const [evaluation, setEvaluation] = useState(data.evaluation);
  if (synced !== data) {
    setSynced(data); setPages(data.pages); setSegments(data.segments); setChapterStatus(data.chapter.status); setJob(data.job); setEvaluation(data.evaluation);
  }

  // Local edits not yet confirmed by the server, and their save state.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const draftsRef = useRef(drafts);
  useEffect(() => { draftsRef.current = drafts; });
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /* Autosave engine (kept in a ref so retries and timers always call the latest version). */
  const autosave = useRef({ flush: async (id: string, attempt?: number): Promise<void> => { void id; void attempt; }, schedule: (id: string, delay?: number) => { void id; void delay; } });
  useEffect(() => {
    const flush = async (id: string, attempt = 0): Promise<void> => {
      const timer = timers.current.get(id);
      if (timer) { clearTimeout(timer); timers.current.delete(id); }
      const value = draftsRef.current[id];
      if (value === undefined) return;
      setSaves(s => ({ ...s, [id]: 'saving' }));
      try {
        const res = await saveDraftAction(id, value);
        if (!res.ok) throw new Error(res.error);
        setSegments(list => list.map(s => s.id === id ? { ...s, translatedText: value.trim() ? value : null, translationStatus: res.data!.translationStatus as WorkspaceSegmentDTO['translationStatus'] } : s));
        if (draftsRef.current[id] === value) {
          setDrafts(d => { const next = { ...d }; delete next[id]; return next; });
          setSaves(s => ({ ...s, [id]: 'saved' }));
          storage.remove(BACKUP(id));
        }
      } catch (error) {
        setSaves(s => ({ ...s, [id]: 'error' }));
        // Keep retrying with backoff while the text is still unsaved; the local backup survives a reload meanwhile.
        if (attempt < 6) timers.current.set(id, setTimeout(() => { void autosave.current.flush(id, attempt + 1); }, Math.min(30_000, 2000 * 2 ** attempt)));
        else toast(error instanceof Error && error.message ? error.message : 'Autosave failed', 'error', 'var(--danger)');
      }
    };
    const schedule = (id: string, delay = AUTOSAVE_MS) => {
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer);
      timers.current.set(id, setTimeout(() => { void autosave.current.flush(id); }, delay));
    };
    autosave.current = { flush, schedule };
  });
  const flushDraft = (id: string) => autosave.current.flush(id);
  const schedule = (id: string, delay?: number) => autosave.current.schedule(id, delay);

  const ordered = useMemo(() => {
    const index = new Map(pages.map((p, i) => [p.id, i]));
    return [...segments].sort((a, b) => (index.get(a.pageId) ?? 0) - (index.get(b.pageId) ?? 0) || a.position - b.position);
  }, [pages, segments]);

  const [mode, setModeState] = useState<Mode>(initialMode);
  const [pageIdx, setPageIdx] = useState(() => {
    const first = data.segments.find(s => !isTranslated(s.translationStatus, data.requireApproval));
    return Math.max(0, data.pages.findIndex(p => p.id === first?.pageId));
  });
  const [selected, setSelected] = useState<string | null>(() => data.segments.find(s => !isTranslated(s.translationStatus, data.requireApproval))?.id ?? data.segments[0]?.id ?? null);
  const [view, setView] = useState<View>('split');
  const [showBoxes, setShowBoxes] = useState(true);
  const [editBoxes, setEditBoxes] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [preview, setPreview] = useState<'original' | 'translated' | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [styleOpen, setStyleOpen] = useState(false);
  const [enterSaves, setEnterSaves] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());

  const page = pages[pageIdx] as WorkspacePageDTO | undefined;
  const onPage = useMemo(() => ordered.filter(s => s.pageId === page?.id), [ordered, page?.id]);
  const editable = chapterStatus !== 'published' && job.status !== 'queued' && job.status !== 'running' && job.status !== 'cancelled';
  const textOf = useCallback((s: WorkspaceSegmentDTO) => drafts[s.id] ?? s.translatedText ?? '', [drafts]);

  const setMode = (next: Mode) => {
    setModeState(next); setDrawing(false);
    window.history.replaceState(null, '', next === 'translate' ? window.location.pathname : `${window.location.pathname}?mode=${next}`);
  };

  /* Remember where the translator was, and restore unsaved local backups (e.g. after a crash or offline period). */
  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const saved = JSON.parse(storage.get(POSITION(chapterId)) ?? 'null') as { pageId?: string; segmentId?: string } | null;
        const idx = saved?.pageId ? data.pages.findIndex(p => p.id === saved.pageId) : -1;
        if (idx >= 0) setPageIdx(idx);
        if (saved?.segmentId && data.segments.some(s => s.id === saved.segmentId)) setSelected(saved.segmentId);
      } catch { /* ignore malformed */ }
      const restored: Record<string, string> = {};
      for (const s of data.segments) {
        try {
          const backup = JSON.parse(storage.get(BACKUP(s.id)) ?? 'null') as { text: string; at: number } | null;
          if (!backup) continue;
          if (backup.text !== (s.translatedText ?? '') && backup.at > new Date(s.updatedAt).getTime()) restored[s.id] = backup.text;
          else storage.remove(BACKUP(s.id));
        } catch { storage.remove(BACKUP(s.id)); }
      }
      if (Object.keys(restored).length) {
        setDrafts(d => ({ ...restored, ...d }));
        setSaves(st => ({ ...st, ...Object.fromEntries(Object.keys(restored).map(id => [id, 'dirty' as SaveState])) }));
        Object.keys(restored).forEach(id => autosave.current.schedule(id, 50));
        toast(`Restored ${Object.keys(restored).length} unsaved translation${Object.keys(restored).length === 1 ? '' : 's'} from this browser`, 'restore', 'var(--info)');
      }
    }, 0);
    return () => window.clearTimeout(restore);
    // Runs once per chapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);
  useEffect(() => { if (page) storage.set(POSITION(chapterId), JSON.stringify({ pageId: page.id, segmentId: selected })); }, [chapterId, page, selected]);

  /* Autosave */

  const setText = (id: string, value: string) => {
    setDrafts(d => ({ ...d, [id]: value }));
    draftsRef.current = { ...draftsRef.current, [id]: value };
    setSaves(s => ({ ...s, [id]: 'dirty' }));
    storage.set(BACKUP(id), JSON.stringify({ text: value, at: Date.now() }));
    schedule(id);
  };

  const anyUnsaved = Object.values(saves).some(s => s === 'dirty' || s === 'saving' || s === 'error');
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (anyUnsaved) { e.preventDefault(); e.returnValue = ''; } };
    const hide = () => { if (document.visibilityState === 'hidden') Object.keys(draftsRef.current).forEach(id => { void autosave.current.flush(id); }); };
    window.addEventListener('beforeunload', guard);
    document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('beforeunload', guard); document.removeEventListener('visibilitychange', hide); };
  }, [anyUnsaved]);

  /* Saving final translations */

  const markRendering = (pageIds: string[]) => setPages(list => list.map(p => pageIds.includes(p.id) ? { ...p, renderStatus: 'queued', editVersion: p.editVersion + 1 } : p));

  const saveFinal = async (items: { id: string; text: string }[]): Promise<boolean> => {
    const list = items.filter(item => item.text.trim());
    if (!list.length) { toast('Type a translation first', 'edit', 'var(--warning)'); return false; }
    for (const item of list) { const t = timers.current.get(item.id); if (t) clearTimeout(t); timers.current.delete(item.id); }
    setSaves(s => ({ ...s, ...Object.fromEntries(list.map(item => [item.id, 'saving' as SaveState])) }));
    let res;
    try { res = await saveTranslationsAction(list.map(item => ({ segmentId: item.id, text: item.text }))); }
    catch { res = { ok: false as const, error: 'Could not reach the server. Your text is kept; try again.' }; }
    if (!res.ok) {
      setSaves(s => ({ ...s, ...Object.fromEntries(list.map(item => [item.id, 'error' as SaveState])) }));
      toast(res.error, 'error', 'var(--danger)');
      return false;
    }
    const byId = new Map(list.map(item => [item.id, item.text]));
    setSegments(all => all.map(s => byId.has(s.id) ? { ...s, translatedText: byId.get(s.id)!.trim(), translationStatus: 'translated', typesetStatus: 'pending' } : s));
    setDrafts(d => { const next = { ...d }; for (const [id, text] of byId) if (next[id] === text) delete next[id]; return next; });
    setSaves(s => ({ ...s, ...Object.fromEntries(list.map(item => [item.id, 'saved' as SaveState])) }));
    list.forEach(item => storage.remove(BACKUP(item.id)));
    markRendering([...new Set(segments.filter(s => byId.has(s.id)).map(s => s.pageId))]);
    return true;
  };

  const select = useCallback((id: string | null, focus = true) => {
    setSelected(id);
    if (!id) return;
    const segment = segments.find(s => s.id === id);
    if (segment) {
      const idx = pages.findIndex(p => p.id === segment.pageId);
      if (idx >= 0) setPageIdx(idx);
    }
    window.setTimeout(() => {
      document.querySelector(`[data-segment-box="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (focus) inputs.current.get(id)?.focus();
    }, 30);
  }, [pages, segments]);

  /** After a save: the next untranslated segment on this page, else the next page that still has work. */
  const advance = (fromId: string, savedIds: string[]) => {
    const after = ordered.map(s => savedIds.includes(s.id) ? { ...s, translationStatus: 'translated' as const } : s);
    const from = after.find(s => s.id === fromId);
    const next = nextUntranslated(after, fromId, data.requireApproval);
    if (!next) { toast(`All ${after.length} segments are translated`, 'task_alt', 'var(--success)'); return; }
    if (from && next.pageId !== from.pageId) {
      const pageNumber = pages.find(p => p.id === from.pageId)?.pageNumber;
      if (!after.some(s => s.pageId === from.pageId && !isTranslated(s.translationStatus, data.requireApproval))) toast(`Page ${pageNumber} complete`, 'task_alt', 'var(--success)');
    }
    select(next.id);
  };

  const saveAndNext = async (id: string | null) => {
    if (!id || !editable) return;
    const segment = segments.find(s => s.id === id);
    if (!segment) return;
    const text = textOf(segment);
    // Already saved and unchanged: just move on.
    if (isTranslated(segment.translationStatus, false) && drafts[id] === undefined) return advance(id, []);
    if (await saveFinal([{ id, text }])) advance(id, [id]);
  };

  const step = (delta: number) => {
    if (!onPage.length) return;
    const index = onPage.findIndex(s => s.id === selected);
    const next = onPage[Math.max(0, Math.min(onPage.length - 1, (index < 0 ? 0 : index) + delta))];
    if (next) select(next.id, false);
  };
  const goPage = (idx: number) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, idx));
    setPageIdx(clamped); setDrawing(false);
    const first = ordered.find(s => s.pageId === pages[clamped]?.id && !isTranslated(s.translationStatus, data.requireApproval)) ?? ordered.find(s => s.pageId === pages[clamped]?.id);
    setSelected(first?.id ?? null);
  };
  const nextUntranslatedAnywhere = () => {
    const next = nextUntranslated(ordered, selected, data.requireApproval);
    if (next) select(next.id); else toast('Nothing left to translate', 'task_alt', 'var(--success)');
  };

  /* Keyboard shortcuts (text editing keys keep their normal behaviour inside fields). */
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') {
        if (preview || bulkOpen || styleOpen || drawing) { e.preventDefault(); setPreview(null); setBulkOpen(false); setStyleOpen(false); setDrawing(false); }
        return;
      }
      if (mode !== 'translate') return;
      if (mod && e.key === 'Enter') { e.preventDefault(); void saveAndNext(selected); return; }
      if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); const s = segments.find(x => x.id === selected); if (s) void saveFinal([{ id: s.id, text: textOf(s) }]); return; }
      const inField = isField(e.target);
      if ((e.altKey || !inField) && !mod) {
        if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight' && (e.altKey || !inField)) { e.preventDefault(); goPage(pageIdx + 1); }
        else if (e.key === 'ArrowLeft' && (e.altKey || !inField)) { e.preventDefault(); goPage(pageIdx - 1); }
      }
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const onTextareaKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>, id: string) => {
    if (e.key === 'Enter' && enterSaves && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
      e.preventDefault(); void saveAndNext(id);
    }
  };

  /* Polling while OCR or final-image rendering is in progress */
  const stalePages = pages.some(p => p.renderStatus === 'queued' || p.renderStatus === 'rendering' || (p.ocrStatus === 'done' && p.renderedVersion < p.editVersion && p.renderStatus !== 'failed'));
  const ocrBusy = job.status === 'queued' || job.status === 'running';
  useEffect(() => {
    if (!stalePages && !ocrBusy) return;
    const timer = setInterval(async () => {
      const res = await workspaceStatusAction(chapterId).catch(() => null);
      if (!res?.ok || !res.data) return;
      const status = res.data;
      if (status.job.status !== job.status && (job.status === 'queued' || job.status === 'running')) { router.refresh(); return; }
      setPages(status.pages); setChapterStatus(status.chapter.status); setJob(status.job); setEvaluation(status.evaluation);
      const byId = new Map(status.segments.map(s => [s.id, s]));
      setSegments(list => list.map(s => {
        const fresh = byId.get(s.id);
        if (!fresh) return s;
        return { ...s, typesetStatus: fresh.typesetStatus, qaFlags: fresh.qaFlags, translationStatus: draftsRef.current[s.id] !== undefined ? s.translationStatus : fresh.translationStatus };
      }));
    }, 2500);
    return () => clearInterval(timer);
  }, [stalePages, ocrBusy, chapterId, job.status, router]);

  /* Segment-level actions */

  const runAction = async <T,>(key: string, fn: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>, success?: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) { toast(res.error, 'error', 'var(--danger)'); return null; }
      if (success) toast(success);
      return res;
    } catch { toast('Could not reach the server. Try again.', 'error', 'var(--danger)'); return null; }
    finally { setBusy(null); }
  };

  const changeBox = async (id: string, box: Box) => {
    const segment = segments.find(s => s.id === id);
    setSegments(list => list.map(s => s.id === id ? { ...s, ...box, typesetStatus: 'pending' } : s));
    const res = await runAction(`box:${id}`, () => updateSegmentLayoutAction(id, { box }));
    if (!res && segment) setSegments(list => list.map(s => s.id === id ? { ...s, x: segment.x, y: segment.y, w: segment.w, h: segment.h } : s));
    else if (segment && isTranslated(segment.translationStatus, false)) markRendering([segment.pageId]);
  };
  const applyStyle = async (id: string, style: TypesetStyleOverride | null) => {
    const segment = segments.find(s => s.id === id);
    const res = await runAction(`style:${id}`, () => updateSegmentLayoutAction(id, { style }), 'Style saved');
    if (res && segment) {
      setSegments(list => list.map(s => s.id === id ? { ...s, style: style ?? {}, typesetStatus: 'pending' } : s));
      if (isTranslated(segment.translationStatus, false)) markRendering([segment.pageId]);
    }
  };
  const addRegion = async (box: Box) => {
    if (!page) return;
    setDrawing(false);
    const res = await runAction('add', () => addSegmentAction(page.id, box, ''), 'Region added');
    if (res?.data) {
      const created: WorkspaceSegmentDTO = { id: res.data.id, pageId: page.id, position: res.data.position, ...box, sourceText: '', correctedSourceText: null, translatedText: null,
        ocrConfidence: null, detectedLanguage: null, origin: 'manual', translationStatus: 'pending', typesetStatus: 'pending', qaFlags: [], style: {}, updatedAt: new Date() };
      setSegments(list => [...list, created]);
      setPages(list => list.map(p => p.id === page.id ? { ...p, ocrStatus: 'done' } : p));
      setSelected(created.id);
    }
  };
  const removeRegion = async (segment: WorkspaceSegmentDTO) => {
    if (!confirm(`Delete segment ${segment.position}? The original lettering in that area stays untouched.`)) return;
    const res = await runAction(`del:${segment.id}`, () => deleteSegmentAction(segment.id), 'Segment deleted');
    if (res) {
      setSegments(list => {
        const rest = list.filter(s => s.id !== segment.id);
        let n = 0;
        return rest.map(s => s.pageId === segment.pageId ? s : s).sort((a, b) => a.position - b.position).map(s => s.pageId === segment.pageId ? { ...s, position: ++n } : s);
      });
      markRendering([segment.pageId]);
    }
  };
  const move = async (segment: WorkspaceSegmentDTO, direction: 'up' | 'down') => {
    const res = await runAction(`move:${segment.id}`, () => moveSegmentAction(segment.id, direction));
    if (res?.data) {
      const order = res.data.order;
      setSegments(list => list.map(s => s.pageId === segment.pageId && order.includes(s.id) ? { ...s, position: order.indexOf(s.id) + 1 } : s));
    }
  };
  const saveSource = async (segment: WorkspaceSegmentDTO, value: string) => {
    if (value.trim() === sourceOf(segment).trim()) return;
    const res = await runAction(`src:${segment.id}`, () => correctSourceTextAction(segment.id, value), 'OCR text corrected');
    if (res?.data) setSegments(list => list.map(s => s.id === segment.id ? { ...s, correctedSourceText: res.data!.correctedSourceText } : s));
  };
  const rerunOcr = async () => {
    if (!page || !confirm(`Re-run OCR on page ${page.pageNumber}? Its current regions are replaced.`)) return;
    const res = await runAction('ocr', () => retryPageOcrAction(page.id));
    if (res?.data) { toast(`OCR found ${res.data.segments} segment${res.data.segments === 1 ? '' : 's'}`); router.refresh(); }
  };
  const accept = async (id: string) => {
    const res = await runAction(id, () => acceptSegmentImageAction(id), 'Marked as reviewed');
    if (res) setSegments(list => list.map(s => s.id === id ? { ...s, typesetStatus: 'accepted' } : s));
    const status = await workspaceStatusAction(chapterId).catch(() => null);
    if (status?.ok && status.data) { setEvaluation(status.data.evaluation); setChapterStatus(status.data.chapter.status); }
  };
  const retryRender = async (pageIds: string[]) => {
    const res = await runAction('render', () => retryPageRenderAction(pageIds), 'Final image queued');
    if (res) markRendering(pageIds);
  };
  const approve = async (ids: string[]) => {
    const res = await runAction('approve', () => approveSegmentsAction(ids), 'Approved');
    if (res) setSegments(list => list.map(s => ids.includes(s.id) && s.translationStatus === 'translated' ? { ...s, translationStatus: 'approved' } : s));
  };
  const publish = async () => {
    if (!confirm(`Publish chapter ${chapterNo(data.chapter.number)} to readers?`)) return;
    const res = await runAction('publish', () => publishManualChapterAction(chapterId), `Chapter ${chapterNo(data.chapter.number)} published`);
    if (res) { setChapterStatus('published'); router.refresh(); }
  };

  /* Bulk copy / paste */

  const copyAll = async () => {
    if (!onPage.length) return toast('No segments on this page');
    if (await copy(formatPageText(onPage.map(sourceOf)))) toast(`Copied ${onPage.length} segment${onPage.length === 1 ? '' : 's'} with [SEGMENT_###] tags`, 'content_copy', 'var(--info)');
  };
  const bulkParsed = useMemo(() => parseBulkTranslation(bulkText), [bulkText]);
  const fillFromBulk = (saveNow: boolean) => {
    const items = onPage.flatMap((s, i) => bulkParsed.has(i + 1) ? [{ id: s.id, text: bulkParsed.get(i + 1)! }] : []);
    if (!items.length) return toast('No [SEGMENT_###] blocks matched this page', 'error', 'var(--danger)');
    items.forEach(item => setText(item.id, item.text));
    setBulkOpen(false); setBulkText('');
    if (saveNow) void saveFinal(items).then(ok => ok && toast(`Saved ${items.length} translation${items.length === 1 ? '' : 's'}`));
    else toast(`Filled ${items.length} of ${onPage.length} segments as drafts`);
  };

  if (!page) return <div className="a-card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>This chapter has no pages.</div>;

  const pageStates: PageState[] = pages.map(p => ({ ...p }));
  const segIndex = Math.max(0, onPage.findIndex(s => s.id === selected));
  const globalSave: [string, string] = Object.values(saves).includes('error') ? ['Save failed', 'var(--danger-text)'] : Object.values(saves).includes('saving') ? ['Saving…', 'var(--ink-2)']
    : Object.values(saves).includes('dirty') ? ['Unsaved changes', 'var(--warning-text)'] : ['Saved', 'var(--success-text)'];
  const rendering = page.renderStatus === 'queued' || page.renderStatus === 'rendering' || page.renderedVersion < page.editVersion;
  const translatedSrc = page.outputSrc ?? page.src;

  const pageChip = (p: WorkspacePageDTO, i: number) => {
    const segs = ordered.filter(s => s.pageId === p.id);
    const complete = pageComplete(pageStates[i], segs, data.requireApproval);
    const started = segs.some(s => s.translationStatus !== 'pending');
    const bg = p.ocrStatus === 'failed' || p.renderStatus === 'failed' ? 'rgba(229,103,92,.3)' : complete ? 'rgba(123,201,160,.3)' : started ? 'rgba(232,130,95,.25)' : p.ocrStatus === 'pending' ? 'transparent' : 'var(--s3)';
    return (
      <button key={p.id} type="button" onClick={() => goPage(i)} title={`Page ${p.pageNumber}${complete ? ' · complete' : ''}`}
        style={{ minWidth: 30, height: 24, borderRadius: 6, border: i === pageIdx ? '1.5px solid var(--ember)' : '1px solid var(--line-1)', background: bg, color: 'var(--ink-1)', font: '500 11px var(--mono)', cursor: 'pointer' }}>{p.pageNumber}</button>
    );
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Link href="/admin/batch" className="btn btn-ghost" style={{ '--h': '34px', '--px': '10px', '--fs': '13px', gap: 6 } as React.CSSProperties}><Icon name="arrow_back" size={18} />Batch</Link>
        <span style={{ font: '600 15px var(--sans)' }}>{data.series.title} · Ch. {chapterNo(data.chapter.number)}</span>
        <span className={`badge xs ${chapterStatus === 'published' ? 'success' : chapterStatus === 'ready' ? 'info' : 'neutral'}`}>{chapterStatus === 'ready' ? 'READY TO PUBLISH' : chapterStatus.replace('_', ' ').toUpperCase()}</span>
        <div style={{ marginLeft: 'auto' }}>
          <Segmented h={32} options={[['ocr', 'OCR review'], ['translate', 'Translate'], ['publish', 'Review & publish']]} value={mode} onChange={v => setMode(v as Mode)} />
        </div>
      </div>

      {ocrBusy && <div className="row" role="status" style={{ gap: 8, padding: '10px 14px', borderRadius: 12, border: '1px solid var(--line-1)', fontSize: 13 }}><span className="spinner" />OCR {job.status === 'queued' ? 'is queued' : `is running · ${job.stageProgress}%`}. Segments appear here when it finishes.</div>}
      {job.status === 'failed' && job.errorMessage && <div className="row" role="alert" style={{ gap: 8, padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(229,103,92,.3)', fontSize: 13, color: 'var(--danger-text)' }}><Icon name="error" size={18} />{job.errorMessage} Retry from the batch dashboard or re-run OCR per page.</div>}
      {!editable && chapterStatus === 'published' && <div className="row" style={{ gap: 8, padding: '10px 14px', borderRadius: 12, border: '1px solid var(--line-1)', fontSize: 13, color: 'var(--ink-3)' }}><Icon name="lock" size={18} />Published chapters are read-only.</div>}

      {mode === 'publish' ? (
        <PublishReview data={data} pages={pages} segments={segments} evaluation={evaluation} chapterStatus={chapterStatus} busy={busy}
          onPublish={publish} onAccept={accept} onRetryRender={retryRender}
          onOpen={(idx, segmentId) => { setMode('translate'); goPage(idx); if (segmentId) setSelected(segmentId); }} />
      ) : (
        <>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', maxHeight: 64, overflowY: 'auto' }} aria-label="Pages">{pages.map(pageChip)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(min(100%,380px),1fr)', gap: 16, alignItems: 'start' }} className="translate-grid">
            <div className="stack" style={{ gap: 8, position: 'sticky', top: 76 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <IconButton icon="chevron_left" label="Previous page" h={32} r={8} variant="boxed" iconSize={18} disabled={pageIdx === 0} onClick={() => goPage(pageIdx - 1)} />
                <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-2)' }}>PAGE {page.pageNumber}/{pages.length}</span>
                <IconButton icon="chevron_right" label="Next page" h={32} r={8} variant="boxed" iconSize={18} disabled={pageIdx === pages.length - 1} onClick={() => goPage(pageIdx + 1)} />
                <Segmented h={28} options={[['original', 'Original'], ['translated', 'Translated'], ['split', 'Split']]} value={view} onChange={v => setView(v as View)} />
                <label className="row" style={{ gap: 4, fontSize: 12 }}><input type="checkbox" checked={showBoxes} onChange={e => setShowBoxes(e.target.checked)} />Regions</label>
                {editable && <label className="row" style={{ gap: 4, fontSize: 12 }}><input type="checkbox" checked={editBoxes || mode === 'ocr'} disabled={mode === 'ocr'} onChange={e => setEditBoxes(e.target.checked)} />Move/resize</label>}
                <IconButton icon="open_in_full" label="Full-size preview" h={32} r={8} variant="boxed" iconSize={18} onClick={() => setPreview(view === 'original' ? 'original' : 'translated')} />
                {rendering && <span className="row" style={{ gap: 6, font: '500 11px var(--mono)', color: 'var(--info-text)' }}><span className="spinner" />RENDERING</span>}
                {page.renderStatus === 'failed' && <Button variant="danger" h={28} onClick={() => retryRender([page.id])}>Retry image</Button>}
              </div>
              <div style={{ maxHeight: 'calc(100vh - 230px)', overflowY: 'auto', borderRadius: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: view === 'split' ? '1fr 1fr' : '1fr', gap: 8 }}>
                  {view !== 'translated' && <PageCanvas page={page} src={page.src} segments={onPage} selectedId={selected} onSelect={id => select(id, mode === 'translate')} label="ORIGINAL"
                    editable={editable && (editBoxes || mode === 'ocr')} drawing={drawing} showBoxes={showBoxes} onBoxChange={changeBox} onDraw={addRegion} />}
                  {view !== 'original' && <PageCanvas page={page} src={translatedSrc} segments={onPage} selectedId={selected} onSelect={id => select(id, mode === 'translate')} label="TRANSLATED"
                    note={page.outputSrc ? (rendering ? ' · UPDATING' : '') : ' · NOT RENDERED YET'} editable={false} drawing={false} showBoxes={showBoxes && view !== 'split'} onBoxChange={changeBox} onDraw={addRegion} />}
                </div>
              </div>
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {mode === 'translate' ? <>
                  <Button variant="secondary" h={30} icon="content_copy" onClick={copyAll}>Copy all page text</Button>
                  {editable && <Button variant="secondary" h={30} icon="content_paste" onClick={() => setBulkOpen(true)}>Paste translations</Button>}
                  {data.requireApproval && editable && <Button variant="ghost" h={30} disabled={busy === 'approve'} onClick={() => approve(onPage.filter(s => s.translationStatus === 'translated').map(s => s.id))}>Approve page</Button>}
                  <label className="row" style={{ gap: 4, fontSize: 12, marginLeft: 'auto' }} title="Shift+Enter inserts a line break"><input type="checkbox" checked={enterSaves} onChange={e => setEnterSaves(e.target.checked)} />Enter = Save &amp; Next</label>
                </> : <>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>OCR {page.ocrStatus}{page.ocrError ? ` · ${page.ocrError}` : ''} · fix text, drag boxes, add missed regions, fix the order.</span>
                  {editable && <Button variant={drawing ? 'primary' : 'secondary'} h={30} icon="add_box" onClick={() => setDrawing(d => !d)}>{drawing ? 'Drag on the image…' : 'Add region'}</Button>}
                  {editable && <Button variant="ghost" h={30} icon="refresh" loading={busy === 'ocr'} disabled={onPage.some(s => s.translatedText?.trim())} title={onPage.some(s => s.translatedText?.trim()) ? 'This page already has translations' : undefined} onClick={rerunOcr}>Re-run OCR</Button>}
                  <Button variant="ghost" h={30} onClick={() => setMode('translate')}>Start translating →</Button>
                </>}
              </div>
              {onPage.length === 0 && <div className="a-card" style={{ padding: 20, fontSize: 13, color: 'var(--ink-3)' }}>{page.ocrStatus === 'pending' ? 'OCR has not read this page yet.' : 'No text was detected on this page. It is delivered as the original image; add a region if text was missed.'}</div>}
              {onPage.map(segment => {
                const isSel = segment.id === selected;
                const saveState = saves[segment.id];
                const done = isTranslated(segment.translationStatus, data.requireApproval);
                return (
                  <div key={segment.id} onClick={() => setSelected(segment.id)} className="stack"
                    style={{ gap: 8, padding: 12, borderRadius: 12, background: 'var(--s1)', border: `1px solid ${isSel ? 'rgba(232,130,95,.6)' : 'var(--line-1)'}` }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ font: '600 12px var(--mono)' }}>SEGMENT {segment.position}</span>
                      <span className={`badge xs ${done ? 'success' : segment.translationStatus === 'draft' ? 'ember' : segment.translationStatus === 'failed' ? 'danger' : 'neutral'}`}>{segment.translationStatus.toUpperCase()}</span>
                      {segment.typesetStatus === 'needs_review' && <span className="badge xs danger" title={segment.qaFlags.join(', ')}>NEEDS IMAGE REVIEW</span>}
                      {segment.typesetStatus === 'failed' && <span className="badge xs danger" title={segment.qaFlags.join(', ')}>IMAGE FAILED</span>}
                      {segment.origin === 'manual' && <span className="badge xs neutral">MANUAL</span>}
                      {segment.ocrConfidence !== null && <span style={{ font: '400 11px var(--mono)', color: segment.ocrConfidence < 0.6 ? 'var(--warning-text)' : 'var(--ink-3)' }}>OCR {segment.ocrConfidence.toFixed(2)}</span>}
                      {saveState && <span style={{ marginLeft: 'auto', font: '500 11px var(--mono)', color: saveState === 'error' ? 'var(--danger-text)' : saveState === 'dirty' ? 'var(--warning-text)' : 'var(--ink-3)' }}>{saveState === 'error' ? 'SAVE FAILED' : saveState === 'saving' ? 'SAVING…' : saveState === 'dirty' ? 'UNSAVED' : 'SAVED'}</span>}
                    </div>
                    {mode === 'translate' ? <>
                      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                        <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                          <span style={{ font: '500 10px var(--mono)', color: 'var(--ink-3)' }}>ORIGINAL</span>
                          <div style={{ font: '500 14px/1.45 var(--sans)', color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{sourceOf(segment) || <em style={{ color: 'var(--ink-4)' }}>No OCR text</em>}</div>
                        </div>
                        <Button variant="secondary" h={28} icon="content_copy" onClick={async e => { e.stopPropagation(); if (await copy(sourceOf(segment))) toast('Original copied', 'content_copy', 'var(--info)'); }}>Copy original</Button>
                      </div>
                      <span style={{ font: '500 10px var(--mono)', color: 'var(--ink-3)' }}>MY TRANSLATION</span>
                      <textarea ref={el => { if (el) inputs.current.set(segment.id, el); else inputs.current.delete(segment.id); }}
                        aria-label={`Translation for segment ${segment.position}`} value={textOf(segment)} disabled={!editable} maxLength={4000} lang="mn" spellCheck
                        onFocus={() => setSelected(segment.id)} onChange={e => setText(segment.id, e.target.value)} onKeyDown={e => onTextareaKey(e, segment.id)}
                        onBlur={() => { if (drafts[segment.id] !== undefined) void flushDraft(segment.id); }}
                        rows={Math.min(6, Math.max(2, Math.ceil(textOf(segment).length / 48)))}
                        style={{ resize: 'vertical', padding: '8px 10px', borderRadius: 8, background: 'var(--s2)', border: `1px solid ${isSel ? 'var(--ember)' : 'rgba(255,255,255,.1)'}`, color: 'var(--ink-1)', font: '400 15px/1.45 var(--sans)', outline: 'none' }} />
                      {editable && (
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <Button variant="primary" h={30} icon="done" loading={saveState === 'saving'} disabled={!textOf(segment).trim()} onClick={e => { e.stopPropagation(); void saveFinal([{ id: segment.id, text: textOf(segment) }]); }}>Save</Button>
                          <Button variant="secondary" h={30} icon="arrow_downward" onClick={e => { e.stopPropagation(); void saveAndNext(segment.id); }}>Next</Button>
                          {data.requireApproval && segment.translationStatus === 'translated' && <Button variant="success" h={30} icon="check" onClick={e => { e.stopPropagation(); void approve([segment.id]); }}>Approve</Button>}
                          {segment.typesetStatus === 'needs_review' && <Button variant="ghost" h={30} onClick={e => { e.stopPropagation(); void accept(segment.id); }}>Looks good</Button>}
                          <Button variant="ghost" h={30} icon="format_size" aria-expanded={isSel && styleOpen} onClick={e => { e.stopPropagation(); setSelected(segment.id); setStyleOpen(o => !(o && isSel)); }}>Style</Button>
                        </div>
                      )}
                      {isSel && styleOpen && editable && <StylePanel key={segment.id} value={segment.style} busy={busy === `style:${segment.id}`} onApply={style => applyStyle(segment.id, style)} />}
                    </> : <>
                      <span style={{ font: '500 10px var(--mono)', color: 'var(--ink-3)' }}>ORIGINAL OCR</span>
                      <div style={{ font: '400 13px/1.4 var(--mono)', color: 'var(--ink-3)', whiteSpace: 'pre-wrap' }}>{segment.sourceText || '—'}</div>
                      <span style={{ font: '500 10px var(--mono)', color: 'var(--ink-3)' }}>CORRECTED TEXT (SOURCE FOR TRANSLATION)</span>
                      <textarea key={`${segment.id}:${segment.correctedSourceText ?? ''}`} defaultValue={sourceOf(segment)} disabled={!editable} rows={Math.max(2, sourceOf(segment).split('\n').length)}
                        aria-label={`Corrected OCR text for segment ${segment.position}`} onFocus={() => setSelected(segment.id)} onBlur={e => saveSource(segment, e.target.value)}
                        style={{ resize: 'vertical', padding: '8px 10px', borderRadius: 8, background: 'var(--s2)', border: '1px solid rgba(255,255,255,.1)', color: 'var(--ink-1)', font: '400 14px/1.45 var(--sans)', outline: 'none' }} />
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-3)' }}>
                        <span style={{ font: '400 11px var(--mono)' }}>COORDINATES</span>
                        {(['x', 'y', 'w', 'h'] as const).map(k => (
                          <label key={`${segment.id}:${k}:${segment[k]}`} className="row" style={{ gap: 3 }}>{k}
                            <input className="a-input mono" defaultValue={Math.round(segment[k] * (k === 'x' || k === 'w' ? page.width : page.height))} inputMode="numeric" disabled={!editable} style={{ width: 70, height: 26, fontSize: 11 }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              onBlur={e => {
                                const v = Number(e.target.value); const total = k === 'x' || k === 'w' ? page.width : page.height;
                                if (!Number.isFinite(v) || Math.round(segment[k] * total) === v) return;
                                const next = { x: segment.x, y: segment.y, w: segment.w, h: segment.h, [k]: v / total };
                                if (next.w <= 0 || next.h <= 0 || next.x < 0 || next.y < 0 || next.x + next.w > 1.0001 || next.y + next.h > 1.0001) { toast('The region must stay inside the page', 'error', 'var(--danger)'); return; }
                                void changeBox(segment.id, next);
                              }} />
                          </label>
                        ))}
                        <span>px · page {page.width}×{page.height}</span>
                      </div>
                      {editable && (
                        <div className="row" style={{ gap: 6 }}>
                          <IconButton icon="arrow_upward" label="Move earlier in reading order" h={28} r={7} variant="boxed" iconSize={16} disabled={segment.position === 1} onClick={() => move(segment, 'up')} />
                          <IconButton icon="arrow_downward" label="Move later in reading order" h={28} r={7} variant="boxed" iconSize={16} disabled={segment.position === onPage.length} onClick={() => move(segment, 'down')} />
                          <Button variant="ghost" h={28} icon="delete" onClick={() => removeRegion(segment)}>Delete</Button>
                        </div>
                      )}
                    </>}
                  </div>
                );
              })}
            </div>
          </div>

          {mode === 'translate' && (
            <div className="row" style={{ position: 'sticky', bottom: 12, zIndex: 10, gap: 10, flexWrap: 'wrap', padding: '10px 14px', borderRadius: 14, background: 'rgba(23,23,27,.96)', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 20px 50px -16px rgba(0,0,0,.9)' }}>
              <Button variant="secondary" h={36} icon="arrow_upward" onClick={() => step(-1)}>Previous</Button>
              <Button variant="primary" h={36} icon="keyboard_return" disabled={!editable || !selected} onClick={() => saveAndNext(selected)}>Save &amp; Next</Button>
              <Button variant="secondary" h={36} icon="skip_next" onClick={nextUntranslatedAnywhere}>Next untranslated</Button>
              <div className="stack grow" style={{ gap: 4, minWidth: 220 }}>
                <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-2)' }}>
                  PAGE {page.pageNumber}/{pages.length} · SEGMENT {onPage.length ? segIndex + 1 : 0}/{onPage.length} · OVERALL {evaluation.percent}% · {evaluation.translated}/{evaluation.segments} TRANSLATED · {evaluation.remaining} LEFT
                </span>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--s4)', overflow: 'hidden' }}><div style={{ width: `${evaluation.percent}%`, height: '100%', background: 'var(--success)', transition: 'width .3s' }} /></div>
              </div>
              <span style={{ font: '500 12px var(--mono)', color: globalSave[1] }}>{globalSave[0].toUpperCase()}</span>
              <span className="meta" title="Keyboard shortcuts">⌘/Ctrl+Enter save &amp; next · ⌘/Ctrl+S save · Alt+↑/↓ segment · Alt+←/→ page · Esc close</span>
            </div>
          )}
        </>
      )}

      {preview && (
        <div role="dialog" aria-label="Page preview" className="scrim" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.85)', overflowY: 'auto', padding: 20 }} onClick={() => setPreview(null)}>
          <div className="stack" style={{ gap: 10, maxWidth: 900, margin: '0 auto' }} onClick={e => e.stopPropagation()}>
            <div className="row" style={{ gap: 8 }}>
              <Segmented h={30} options={[['original', 'Original'], ['translated', 'Translated']]} value={preview} onChange={v => setPreview(v as 'original' | 'translated')} />
              <span className="meta">PAGE {page.pageNumber} · ESC TO CLOSE</span>
              <IconButton icon="close" label="Close preview" h={32} r={8} variant="boxed" style={{ marginLeft: 'auto' }} onClick={() => setPreview(null)} />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- private page image */}
            <img src={(preview === 'original' ? page.src : translatedSrc) ?? ''} alt={`Page ${page.pageNumber} ${preview}`} style={{ width: '100%', borderRadius: 8 }} />
          </div>
        </div>
      )}

      {bulkOpen && (
        <div role="dialog" aria-label="Paste translations" className="scrim" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.7)', display: 'grid', placeItems: 'center', padding: 20 }} onClick={() => setBulkOpen(false)}>
          <div className="a-card stack" style={{ gap: 10, padding: 18, width: 'min(720px,100%)' }} onClick={e => e.stopPropagation()}>
            <span style={{ font: '600 15px var(--sans)' }}>Paste translations for page {page.pageNumber}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Use the same [SEGMENT_001] blocks that “Copy all page text” produced (or a numbered list “1. …”). Matching segments are filled in order.</span>
            <textarea autoFocus value={bulkText} onChange={e => setBulkText(e.target.value)} rows={12} placeholder={'[SEGMENT_001]\nОрчуулга…\n\n[SEGMENT_002]\nОрчуулга…'}
              style={{ resize: 'vertical', padding: 10, borderRadius: 8, background: 'var(--s2)', border: '1px solid rgba(255,255,255,.1)', color: 'var(--ink-1)', font: '400 14px/1.5 var(--mono)' }} />
            <span className="meta">{bulkParsed.size} BLOCK{bulkParsed.size === 1 ? '' : 'S'} FOUND · {onPage.filter((_, i) => bulkParsed.has(i + 1)).length} OF {onPage.length} SEGMENTS MATCH</span>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" h={34} onClick={() => setBulkOpen(false)}>Cancel</Button>
              <Button variant="secondary" h={34} disabled={!bulkParsed.size} onClick={() => fillFromBulk(false)}>Fill as drafts</Button>
              <Button variant="primary" h={34} disabled={!bulkParsed.size} onClick={() => fillFromBulk(true)}>Fill &amp; save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
