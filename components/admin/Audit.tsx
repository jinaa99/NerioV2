'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, useTransition } from 'react';
import Pager from '@/components/Pager';
import { Icon } from '@/components/ui';
import type { AuditArea, AuditLogDTO } from '@/server/data/audit';

const AREAS: [AuditArea | '', string][] = [['', 'All'], ['series', 'Series'], ['chapter', 'Chapters'], ['translation_job', 'Pipeline'], ['review', 'Review'], ['user', 'Users'], ['payment', 'Payments'], ['report', 'Reports'], ['settings', 'Settings']];
const TONE: Record<string, string> = {
  delete: 'danger', suspend: 'danger', reject: 'danger', revoke: 'warning', cancel: 'warning', dismiss: 'neutral', unpublish: 'warning',
  confirm: 'success', publish: 'success', grant: 'ember', reactivate: 'success', resolve: 'success',
};
const toneOf = (action: string) => TONE[action.split('.').pop() ?? ''] ?? 'info';
const when = (d: Date) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function Audit({ data, area, q }: { data: { items: AuditLogDTO[]; total: number; limit: number; offset: number }; area: AuditArea | ''; q: string }) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState(q);
  const [open, setOpen] = useState<number | null>(null);
  const go = (next: { area?: string; q?: string }) => {
    const sp = new URLSearchParams();
    const a = next.area ?? area, nq = (next.q ?? query).trim();
    if (a) sp.set('area', a);
    if (nq) sp.set('q', nq);
    start(() => router.replace(sp.size ? `${path}?${sp}` : path));
  };
  useEffect(() => {
    if (query === q) return;
    const t = setTimeout(() => go({ q: query }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typing triggers the search
  }, [query]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>Every administrative change, who made it and from where. Entries can’t be edited or deleted.</span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="searchbox" style={{ flex: '1 1 220px', maxWidth: 320, '--h': '36px', borderRadius: 9, padding: '0 10px' } as React.CSSProperties}>
          <Icon name="search" size={18} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Actor email or target id" aria-label="Search audit log" style={{ fontSize: 13 }} />
        </label>
        <select aria-label="Area" className="a-select" value={area} onChange={e => go({ area: e.target.value })}>
          {AREAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="meta" style={{ marginLeft: 'auto' }}>{data.total} ENTRIES</span>
      </div>
      <div className="a-table-wrap" style={{ opacity: pending ? .6 : 1, transition: 'opacity .2s' }}>
        <table className="a-table" style={{ minWidth: 820 }}>
          <thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>TARGET</th><th>IP</th><th /></tr></thead>
          <tbody>
            {data.items.map(e => (
              <Fragment key={e.id}>
                <tr>
                  <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-2)', whiteSpace: 'nowrap' }} suppressHydrationWarning>{when(e.createdAt)}</td>
                  <td>{e.actor ? <div className="stack"><span style={{ fontWeight: 600 }}>{e.actor.name ?? e.actor.email}</span><span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{e.actor.email}</span></div> : <span style={{ color: 'var(--ink-4)' }}>System / deleted user</span>}</td>
                  <td><span className={`badge xs ${toneOf(e.action)}`}>{e.action.toUpperCase()}</span></td>
                  <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-2)' }}>{e.targetType}{e.targetId ? <span style={{ color: 'var(--ink-4)' }}> · {e.targetId.length > 18 ? `${e.targetId.slice(0, 8)}…` : e.targetId}</span> : null}</td>
                  <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-3)' }}>{e.ipAddress ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {Object.keys(e.metadata).length > 0 && (
                      <button type="button" className="btn btn-ghost" aria-expanded={open === e.id} onClick={() => setOpen(o => (o === e.id ? null : e.id))} style={{ '--h': '28px', '--px': '8px', '--fs': '12px' } as React.CSSProperties}>
                        Details<Icon name={open === e.id ? 'expand_less' : 'expand_more'} size={16} />
                      </button>
                    )}
                  </td>
                </tr>
                {open === e.id && (
                  <tr><td colSpan={6} style={{ background: 'rgba(255,255,255,.02)' }}>
                    <pre style={{ margin: 0, font: '400 12px/1.5 var(--mono)', color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify({ target: e.targetId, ...e.metadata }, null, 2)}</pre>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {data.items.length === 0 && <div className="stack" style={{ padding: 40, alignItems: 'center', gap: 6, color: 'var(--ink-3)' }}><Icon name="policy" size={26} />No entries match.</div>}
      </div>
      <Pager total={data.total} limit={data.limit} offset={data.offset} path={path} params={{ area: area || undefined, q: q || undefined }} />
    </div>
  );
}
