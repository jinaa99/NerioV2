'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon, Segmented } from '@/components/ui';
import { STAGES, adminSeries } from '@/lib/admin-data';
import { cover } from '@/lib/data';
import { useAdmin } from './store';

const TOP: [string, string, string][] = [['lantern', '612K', '+18%'], ['ninth', '488K', '+6%'], ['bloom', '351K', '+11%'], ['glass', '298K', '−3%'], ['salt', '270K', '+1%']];
const STAGE_BASE = [2, 1, 3, 1, 2, 0, 1, 4, 0];

export default function Overview() {
  const { jobs, pays, reports } = useAdmin();
  const router = useRouter();
  const [range, setRange] = useState(1);
  const failed = jobs.filter(j => j.status === 'FAILED').length;
  const running = jobs.filter(j => j.status === 'RUNNING').length;
  const pendingPays = pays.filter(p => p === 'pending').length;
  const openReports = reports.filter(Boolean).length;

  const metrics: [string, string, string, string, string][] = [
    ['Total users', 'group', '214,380', '↑ 2,140 this week', '/admin/users'],
    ['Active users · 24h', 'bolt', '18,402', '↑ 6.2% vs last week', '/admin/users'],
    ['Total series', 'collections_bookmark', '312', '↑ 4 this month', '/admin/series'],
    ['Total chapters', 'auto_stories', '18,955', '↑ 146 this month', '/admin/chapters'],
    ['Total reads', 'visibility', '96.1M', '↑ 4.82M · 30 days', '/admin'],
    ['Processing jobs', 'memory', String(running), 'avg. 11 min per chapter', '/admin/processing'],
    ['Failed jobs', 'error', String(failed), failed ? 'Needs retry' : 'All clear', '/admin/processing'],
  ];
  const bars = Array.from({ length: 30 }, (_, i) => 45 + Math.sin(i / 2.2 + range) * 14 + (i % 7 === 5 ? 22 : 0) + i * .9);
  const attention: [string, string, string, string, string][] = [
    ['error', 'var(--danger)', `${failed} failed jobs`, 'OCR timeout, corrupt ZIP', '/admin/processing'],
    ['translate', 'var(--warning)', '5 chapters awaiting review', 'Lowest confidence 0.62 on Lantern Keeper 113', '/admin/queue'],
    ['payments', 'var(--ember)', `${pendingPays} transfers to confirm`, 'Oldest submitted yesterday 21:47', '/admin/users?tab=payments'],
    ['flag', 'var(--info)', `${openReports} open reader reports`, '2 translation, 1 missing page', '/admin/reports'],
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,190px),1fr))', gap: 12 }}>
        {metrics.map(([label, icon, value, delta, href], i) => {
          const alert = i === 6 && failed > 0;
          return (
            <Link key={label} href={href} className="metric" style={{ borderColor: alert ? 'rgba(229,103,92,.3)' : undefined }}>
              <span className="row" style={{ justifyContent: 'space-between', font: '500 12px var(--sans)', color: 'var(--ink-3)' }}>{label}<Icon name={icon} size={17} /></span>
              <span style={{ font: '500 28px/1 var(--mono)', letterSpacing: '-.03em', color: alert ? 'var(--danger-text)' : 'var(--ink-1)' }}>{value}</span>
              <span style={{ font: '500 12px var(--mono)', color: i === 6 ? (failed ? 'var(--ink-2)' : 'var(--success-text)') : i === 5 ? 'var(--ink-3)' : 'var(--success-text)' }}>{delta}</span>
            </Link>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,460px),1fr))', gap: 16 }}>
        <section className="a-section">
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 2 }}><span style={{ font: '600 15px var(--sans)' }}>Chapter reads</span><span className="meta">LAST 30 DAYS · 4.82M</span></div>
            <Segmented h={28} options={[[0, '7d'], [1, '30d'], [2, '90d']]} value={range} onChange={setRange} />
          </div>
          <div className="row" style={{ height: 180, alignItems: 'flex-end', gap: 3 }}>
            {bars.map((v, i) => (
              <div key={i} title={`${Math.round(v * 3.2)}K reads`} className="read-bar" style={{ flex: 1, height: `${Math.min(100, v)}%`, borderRadius: '3px 3px 0 0', background: i === 29 ? 'var(--ember)' : 'var(--s4)', transition: 'height .4s var(--ease)' }} />
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', font: '400 11px var(--mono)', color: 'var(--ink-4)' }}><span>SEP 3</span><span>SEP 18</span><span>OCT 2</span></div>
        </section>
        <section className="a-section" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ font: '600 15px var(--sans)' }}>Pipeline right now</span>
            <Link href="/admin/processing" style={{ color: 'var(--ink-2)', font: '500 13px var(--sans)' }}>Open processing →</Link>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {STAGES.map((name, i) => {
              const n = STAGE_BASE[i] + (i === 1 ? failed : 0);
              return (
                <div key={name} style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr) 28px', alignItems: 'center', gap: 12 }}>
                  <span style={{ font: '500 11px var(--mono)', color: 'var(--ink-2)' }}>{name}</span>
                  <div style={{ height: 6, borderRadius: 3, background: '#1A1A1E' }}><div style={{ width: `${Math.min(100, n * 18)}%`, height: '100%', borderRadius: 3, background: i === 1 && failed ? 'var(--danger)' : i === 7 ? 'var(--info)' : 'var(--ember)' }} /></div>
                  <span style={{ font: '500 12px var(--mono)', textAlign: 'right', color: n ? 'var(--ink-1)' : 'var(--ink-4)' }}>{n}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,460px),1fr))', gap: 16 }}>
        <section className="a-card" style={{ overflow: 'hidden' }}>
          <div className="a-section-head"><span style={{ font: '600 15px var(--sans)' }}>Needs attention</span><span style={{ font: '500 11px var(--mono)', color: 'var(--ink-3)' }}>{attention.length} ITEMS</span></div>
          {attention.map(([icon, color, title, sub, href]) => (
            <button key={title} type="button" className="row-btn" style={{ gap: 12, padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,.05)', borderRadius: 0 }} onClick={() => router.push(href)}>
              <Icon name={icon} color={color} />
              <div className="stack grow" style={{ gap: 2 }}><span style={{ font: '600 14px var(--sans)' }}>{title}</span><span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{sub}</span></div>
              <Icon name="chevron_right" color="var(--ink-4)" />
            </button>
          ))}
        </section>
        <section className="a-card" style={{ overflow: 'hidden' }}>
          <div className="a-section-head"><span style={{ font: '600 15px var(--sans)' }}>Top series · 7 days</span></div>
          {TOP.map(([id, reads, delta], i) => {
            const s = adminSeries(id);
            return (
              <div key={id} className="row" style={{ gap: 12, padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-4)', width: 16 }}>{i + 1}</span>
                <div style={{ width: 28, aspectRatio: '3/4', borderRadius: 5, background: cover(s.hue) }} />
                <span className="grow" style={{ font: '500 14px var(--sans)' }}>{s.title}</span>
                <span style={{ font: '500 13px var(--mono)' }}>{reads}</span>
                <span style={{ font: '500 12px var(--mono)', width: 56, textAlign: 'right', color: delta.startsWith('−') ? 'var(--danger-text)' : 'var(--success-text)' }}>{delta}</span>
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}
