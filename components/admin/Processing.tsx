'use client';

import { Button } from '@/components/ui';
import { STAGES, STAGE_SHORT, adminSeries, type JobStatus } from '@/lib/admin-data';
import { cover } from '@/lib/data';
import { useAdmin } from './store';

const TONE: Record<JobStatus, string> = { RUNNING: 'ember', FAILED: 'danger', READY: 'info', CANCELLED: 'neutral' };

export default function Processing() {
  const { jobs, setJobs, toast } = useAdmin();
  const failed = jobs.some(j => j.status === 'FAILED');
  const workers: [string, string, string][] = [
    ['ocr-worker-1', 'Lantern Keeper 115 · cleaning', 'var(--success)'],
    ['ocr-worker-2', failed ? 'Idle after failure' : 'Idle', failed ? 'var(--warning)' : 'var(--success)'],
    ['mt-worker-1', 'Glass Tide 49 · OCR', 'var(--success)'],
    ['render-1', 'Bloom After Ruin 57 · QA', 'var(--success)'],
  ];

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,180px),1fr))', gap: 10 }}>
        {workers.map(([name, task, dot]) => (
          <div key={name} className="a-card stack" style={{ padding: '12px 14px', borderRadius: 12, gap: 6 }}>
            <span className="row" style={{ gap: 8, font: '500 12px var(--mono)' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />{name}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{task}</span>
          </div>
        ))}
      </div>
      {jobs.map(j => {
        const s = adminSeries(j.sid);
        const isFailed = j.status === 'FAILED';
        return (
          <div key={j.id} className="a-card stack" style={{ padding: 16, borderRadius: 14, gap: 14, borderColor: isFailed ? 'rgba(229,103,92,.25)' : undefined }}>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div style={{ width: 32, aspectRatio: '3/4', borderRadius: 5, background: cover(s.hue), flex: 'none' }} />
              <div className="stack" style={{ flex: '1 1 200px', gap: 2 }}>
                <span style={{ font: '600 14px var(--sans)' }}>{s.title} · Ch. {j.ch}</span>
                <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{j.id} · STARTED {j.started}</span>
              </div>
              <span className={`badge xs ${TONE[j.status]}`} style={{ padding: '4px 8px', borderRadius: 6 }}>{j.status === 'RUNNING' ? `${STAGES[j.stage]} · ${Math.round(j.pct)}%` : j.status}</span>
              {isFailed && <Button variant="secondary" h={32} px={12} icon="refresh" onClick={() => { setJobs(js => js.map(k => (k.id === j.id ? { ...k, status: 'RUNNING', pct: 0 } : k))); toast(`${j.id} restarted`, 'refresh', 'var(--info)'); }}>Retry</Button>}
              {j.status === 'RUNNING' && <Button variant="ghost" h={32} onClick={() => setJobs(js => js.map(k => (k.id === j.id ? { ...k, status: 'CANCELLED' } : k)))}>Cancel</Button>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,minmax(0,1fr))', gap: 4 }}>
              {STAGES.map((name, i) => {
                const cur = i === j.stage;
                const bg = i < j.stage ? 'var(--success)' : cur ? (isFailed ? 'var(--danger)' : j.status === 'READY' ? 'var(--info)' : `linear-gradient(90deg,#E8825F ${j.pct}%,#2A2A30 ${j.pct}%)`) : 'var(--s4)';
                const color = i < j.stage ? 'var(--success-text)' : cur ? (isFailed ? 'var(--danger-text)' : 'var(--ember-text)') : 'var(--ink-4)';
                return (
                  <div key={name} title={name} className="stack" style={{ gap: 6, minWidth: 0 }}>
                    <div style={{ height: 4, borderRadius: 2, background: bg }} />
                    <span className="ellipsis" style={{ font: '500 9px var(--mono)', color }}>{STAGE_SHORT[i]}</span>
                  </div>
                );
              })}
            </div>
            {isFailed && <div style={{ font: '400 12px var(--mono)', color: 'var(--danger-text)', padding: '8px 10px', borderRadius: 8, background: 'rgba(229,103,92,.06)' }}>{j.error}</div>}
          </div>
        );
      })}
    </div>
  );
}
