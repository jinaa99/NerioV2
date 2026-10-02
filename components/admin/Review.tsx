'use client';

import { useRouter } from 'next/navigation';
import { Button, Icon, IconButton, Segmented } from '@/components/ui';
import { REGIONS, confColors } from '@/lib/admin-data';
import { useAdmin, type RegionState } from './store';

const STATE_TONE: Record<RegionState, string> = { APPROVED: 'success', PENDING: 'neutral', REJECTED: 'danger', EDITED: 'info' };

export default function Review() {
  const { rv, setRv, toast } = useAdmin();
  const router = useRouter();
  const resolved = rv.states.filter(s => s === 'APPROVED' || s === 'EDITED').length;
  const rejected = rv.states.filter(s => s === 'REJECTED').length;
  const canPublish = resolved === REGIONS.length;

  const panes = [
    { label: 'ORIGINAL · KO', tag: 'RAW PAGE 12', translated: false },
    { label: 'TRANSLATED · EN', tag: 'TYPESET PREVIEW', translated: true },
  ];
  const shown = rv.view === 0 ? panes : [panes[rv.view - 1]];

  const toggleEdit = (i: number) => setRv(x => {
    const closing = x.editing === i;
    return { editing: closing ? -1 : i, sel: i, states: closing && x.text[i] !== REGIONS[i].en ? x.states.map((s, k) => (k === i ? 'EDITED' : s)) : x.states };
  });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Button variant="ghost" h={36} px={10} fs={13} icon="arrow_back" onClick={() => router.push('/admin/queue')}>Queue</Button>
        <span style={{ font: '600 15px var(--sans)' }}>The Lantern Keeper · Ch. 113</span>
        <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
          <IconButton icon="chevron_left" label="Previous page" h={34} r={8} variant="boxed" iconSize={18} onClick={() => setRv({ page: Math.max(1, rv.page - 1) })} />
          <span style={{ font: '500 12px var(--mono)', padding: '0 8px', color: 'var(--ink-2)' }}>PAGE {rv.page} / 48</span>
          <IconButton icon="chevron_right" label="Next page" h={34} r={8} variant="boxed" iconSize={18} onClick={() => setRv({ page: Math.min(48, rv.page + 1) })} />
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Segmented h={30} options={[[0, 'Side by side'], [1, 'Original'], [2, 'Translated']]} value={rv.view} onChange={v => setRv({ view: v as 0 | 1 | 2 })} />
        <Button variant="outline" h={36} px={10} fs={12} icon="select_all" aria-pressed={rv.boxes} onClick={() => setRv({ boxes: !rv.boxes })}
          style={{ background: rv.boxes ? 'rgba(232,130,95,.12)' : 'var(--s2)', borderColor: 'rgba(255,255,255,.1)' }}>Text regions</Button>
        <span className="meta" style={{ marginLeft: 'auto' }}>{REGIONS.length} REGIONS · {REGIONS.filter(r => r.warn).length} WARNINGS · MIN 0.62</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,520px),1fr))', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 12 }}>
          {shown.map(pane => (
            <div key={pane.label} className="stack" style={{ gap: 8 }}>
              <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>{pane.label}</span>
              <div className="stripes" style={{ position: 'relative', aspectRatio: '800/1240', borderRadius: 10, overflow: 'hidden', background: 'linear-gradient(170deg,oklch(.34 .05 40),oklch(.18 .03 30))', border: '1px solid rgba(255,255,255,.08)' }}>
                <span style={{ position: 'absolute', left: 10, bottom: 10, font: '400 10px var(--mono)', color: 'rgba(255,255,255,.45)' }}>{pane.tag}</span>
                {REGIONS.map((r, i) => {
                  const [c] = confColors(r.conf);
                  const sel = rv.sel === i;
                  return (
                    <div key={i} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h }}>
                      <button type="button" aria-label={`Region ${i + 1}`} className="region-btn" onClick={() => setRv({ sel: i })}
                        style={{
                          background: pane.translated ? 'rgba(250,248,244,.94)' : 'rgba(250,248,244,.9)',
                          border: rv.boxes ? (sel ? '2px solid var(--ember)' : `1.5px dashed ${c}`) : '1px solid rgba(0,0,0,.1)',
                          font: pane.translated ? '600 clamp(8px,1vw,12px) var(--sans)' : '500 clamp(8px,1vw,11px) var(--kr)',
                        }}>
                        {pane.translated ? rv.text[i] : r.ko}
                      </button>
                      {rv.boxes && (
                        <span style={{ position: 'absolute', top: -7, left: -7, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: sel ? 'var(--ember)' : c, color: 'var(--bg)', font: '600 10px var(--mono)', display: 'grid', placeItems: 'center', pointerEvents: 'none', boxShadow: '0 0 0 2px rgba(11,11,13,.6)' }}>{i + 1}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="stack" style={{ gap: 10 }}>
          {REGIONS.map((r, i) => {
            const [c, ct] = confColors(r.conf);
            const sel = rv.sel === i, editing = rv.editing === i, state = rv.states[i];
            return (
              <div key={i} onClick={() => setRv({ sel: i })} className="stack" style={{ padding: 14, borderRadius: 14, background: 'var(--s1)', border: `1px solid ${sel ? 'rgba(232,130,95,.5)' : 'var(--line-1)'}`, gap: 10, cursor: 'pointer', transition: 'border-color .2s' }}>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: sel ? 'var(--ember)' : c, color: 'var(--bg)', font: '600 11px var(--mono)', display: 'grid', placeItems: 'center' }}>{i + 1}</span>
                  <span style={{ font: '500 11px var(--mono)', color: 'var(--ink-3)' }}>{r.kind}</span>
                  <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
                    <div style={{ width: 56, height: 4, borderRadius: 2, background: 'var(--s4)' }}><div style={{ width: `${r.conf * 100}%`, height: '100%', borderRadius: 2, background: c }} /></div>
                    <span style={{ font: '500 12px var(--mono)', color: ct }}>{r.conf.toFixed(2)}</span>
                  </div>
                  <span className={`badge xs ${STATE_TONE[state]}`}>{state}</span>
                </div>
                {r.warn && <div className="row" style={{ gap: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(230,194,106,.08)', fontSize: 12, color: 'var(--warning-text)', alignItems: 'flex-start' }}><Icon name="warning" size={16} />{r.warn}</div>}
                <div style={{ font: '500 14px/1.5 var(--kr)', color: 'var(--ink-2)' }}>{r.ko}</div>
                {editing
                  ? <textarea aria-label={`Translation for region ${i + 1}`} value={rv.text[i]} onClick={e => e.stopPropagation()} autoFocus
                      onChange={e => { const v = e.target.value; setRv(x => ({ text: x.text.map((t, k) => (k === i ? v : t)) })); }}
                      style={{ minHeight: 72, resize: 'vertical', padding: '10px 12px', borderRadius: 9, background: 'var(--s2)', border: '1px solid var(--ember)', color: 'var(--ink-1)', font: '400 14px/1.5 var(--sans)', outline: 'none', boxShadow: '0 0 0 3px rgba(232,130,95,.15)' }} />
                  : <div style={{ font: '400 15px/1.5 var(--sans)' }}>{rv.text[i]}</div>}
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Button variant="secondary" h={32} icon={editing ? 'done' : 'edit'} onClick={e => { e.stopPropagation(); toggleEdit(i); }}>{editing ? 'Done' : 'Edit'}</Button>
                  <Button variant="success" h={32} icon="check" onClick={e => { e.stopPropagation(); setRv(x => ({ editing: -1, states: x.states.map((s, k) => (k === i ? 'APPROVED' : s)), sel: Math.min(5, i + 1) })); }}>Approve</Button>
                  <Button variant="danger" h={32} icon="close" onClick={e => { e.stopPropagation(); setRv(x => ({ states: x.states.map((s, k) => (k === i ? 'REJECTED' : s)) })); toast(`Region ${i + 1} sent for re-translation`, 'replay', 'var(--warning)'); }}>Reject</Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="row" style={{ position: 'sticky', bottom: 12, zIndex: 10, gap: 10, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 14, background: 'rgba(23,23,27,.96)', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 20px 50px -16px rgba(0,0,0,.9)' }}>
        <div className="stack" style={{ flex: '1 1 200px', gap: 6 }}>
          <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-2)' }}>{resolved} OF {REGIONS.length} REGIONS APPROVED ON THIS PAGE{rejected ? ` · ${rejected} REJECTED` : ''} · 47 OTHER PAGES PASSED QA</span>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--s4)', overflow: 'hidden' }}><div style={{ width: `${(resolved / REGIONS.length) * 100}%`, height: '100%', background: 'var(--success)', transition: 'width .3s' }} /></div>
        </div>
        <Button variant="secondary" h={40} onClick={() => { setRv(x => ({ editing: -1, states: x.states.map(s => (s === 'EDITED' ? s : 'APPROVED')) })); toast('All regions on page 12 approved'); }}>Approve page</Button>
        <Button variant="danger" h={40} style={{ background: 'transparent', borderColor: 'rgba(229,103,92,.3)' }} onClick={() => toast('Chapter 113 sent back to translation', 'replay', 'var(--warning)')}>Send back</Button>
        <Button variant="primary" h={40} icon="publish" disabled={!canPublish} title={canPublish ? 'Publish chapter 113' : 'Approve every region to publish'}
          onClick={() => { toast('Chapter 113 published · followers notified'); setTimeout(() => router.push('/admin/queue'), 500); }}>Publish chapter</Button>
      </div>
    </div>
  );
}
