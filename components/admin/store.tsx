'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastViewport, useToastQueue, type PushToast } from '@/components/ui';
import { INITIAL_JOBS, REGIONS, adminSeries, type Job } from '@/lib/admin-data';

export type UploadPhase = 'form' | 'uploading' | 'processing' | 'failed' | 'ready' | 'published';
export type Upload = {
  series: string; num: string; title: string; file: { name: string; size: number } | null; drag: boolean; err: string;
  phase: UploadPhase; uploadPct: number; stage: number; stagePct: number; simFail: boolean; times: string[];
};
export type RegionState = 'APPROVED' | 'PENDING' | 'REJECTED' | 'EDITED';
export type Review = { page: number; view: 0 | 1 | 2; boxes: boolean; sel: number; editing: number; states: RegionState[]; text: string[] };
type PayStatus = 'pending' | 'confirmed' | 'declined';

type AdminCtx = {
  jobs: Job[];
  setJobs: (fn: (j: Job[]) => Job[]) => void;
  up: Upload;
  setUp: (p: Partial<Upload>) => void;
  startUpload: (resume?: boolean) => void;
  rv: Review;
  setRv: (p: Partial<Review> | ((r: Review) => Partial<Review>)) => void;
  pays: PayStatus[];
  setPay: (i: number, s: PayStatus) => void;
  reports: boolean[];
  resolveReport: (i: number) => void;
  threshold: number;
  setThreshold: (n: number) => void;
  toggles: boolean[];
  flipToggle: (i: number) => void;
  toast: PushToast;
};

const Ctx = createContext<AdminCtx | null>(null);
export function useAdmin() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAdmin must be used inside <AdminProvider>');
  return c;
}

const clock = () => new Date().toTimeString().slice(0, 8);

export function AdminProvider({ children }: { children: ReactNode }) {
  const { toasts, push, dismiss } = useToastQueue(3000);
  const [jobs, setJobsState] = useState<Job[]>(INITIAL_JOBS);
  const [up, setUpState] = useState<Upload>({ series: 'lantern', num: '115', title: '', file: null, drag: false, err: '', phase: 'form', uploadPct: 0, stage: 0, stagePct: 0, simFail: false, times: [] });
  const [rv, setRvState] = useState<Review>({ page: 12, view: 0, boxes: true, sel: 3, editing: -1, states: ['APPROVED', 'APPROVED', 'APPROVED', 'PENDING', 'PENDING', 'PENDING'], text: REGIONS.map(r => r.en) });
  const [pays, setPays] = useState<PayStatus[]>(['pending', 'pending', 'pending', 'confirmed']);
  const [reports, setReports] = useState([true, true, true, false, true]);
  const [threshold, setThreshold] = useState(80);
  const [toggles, setToggles] = useState([true, true, false]);

  // Simulated worker progress for running jobs.
  useEffect(() => {
    const t = setInterval(() => setJobsState(js => js.map(j => {
      if (j.status !== 'RUNNING') return j;
      let pct = j.pct + 6 + Math.random() * 8, stage = j.stage, status: Job['status'] = j.status;
      if (pct >= 100) { stage++; pct = 0; if (stage >= 7) { stage = 7; pct = 100; status = 'READY'; } }
      return { ...j, pct, stage, status };
    })), 900);
    return () => clearInterval(t);
  }, []);

  const upRef = useRef(up);
  useEffect(() => { upRef.current = up; });
  const timer = useRef<number>(0);
  useEffect(() => () => clearInterval(timer.current), []);

  const setUp = useCallback((p: Partial<Upload>) => setUpState(u => ({ ...u, ...p })), []);

  const startUpload = useCallback((resume?: boolean) => {
    const u = upRef.current;
    if (!u.file) return setUp({ err: 'Add a chapter ZIP first.' });
    if (resume) setUp({ phase: 'processing', stage: 1, stagePct: 0, simFail: false, times: u.times.slice(0, 1) });
    else setUp({ phase: 'uploading', uploadPct: 0, stage: 0, stagePct: 0, times: [] });
    clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const s = upRef.current;
      if (s.phase === 'uploading') {
        const p = s.uploadPct + 9;
        return setUp(p >= 100 ? { uploadPct: 100, phase: 'processing' } : { uploadPct: p });
      }
      if (s.phase !== 'processing') return;
      const p = s.stagePct + (s.stage === 2 ? 7 : 14);
      if (s.simFail && s.stage === 1 && p > 60) {
        clearInterval(timer.current);
        push('OCR failed on page 31', 'error', 'var(--danger)');
        return setUp({ phase: 'failed', stagePct: 60 });
      }
      if (p >= 100) {
        const times = [...s.times, clock()];
        if (s.stage + 1 >= 7) {
          clearInterval(timer.current);
          push(`Chapter ${s.num} is ready`);
          return setUp({ stage: 7, stagePct: 0, phase: 'ready', times });
        }
        return setUp({ stage: s.stage + 1, stagePct: 0, times });
      }
      setUp({ stagePct: p });
    }, 160);
  }, [push, setUp]);

  const setRv = useCallback((p: Partial<Review> | ((r: Review) => Partial<Review>)) => setRvState(r => ({ ...r, ...(typeof p === 'function' ? p(r) : p) })), []);
  const setJobs = useCallback((fn: (j: Job[]) => Job[]) => setJobsState(fn), []);
  const setPay = useCallback((i: number, s: PayStatus) => setPays(p => p.map((x, k) => (k === i ? s : x))), []);
  const resolveReport = useCallback((i: number) => setReports(r => r.map((x, k) => (k === i ? false : x))), []);
  const flipToggle = useCallback((i: number) => setToggles(t => t.map((x, k) => (k === i ? !x : x))), []);

  const value = useMemo<AdminCtx>(() => ({
    jobs, setJobs, up, setUp, startUpload, rv, setRv, pays, setPay, reports, resolveReport, threshold, setThreshold, toggles, flipToggle, toast: push,
  }), [jobs, setJobs, up, setUp, startUpload, rv, setRv, pays, setPay, reports, resolveReport, threshold, toggles, flipToggle, push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} align="right" bottom="20px" />
    </Ctx.Provider>
  );
}

export const seriesTitle = (id: string) => adminSeries(id).title;
