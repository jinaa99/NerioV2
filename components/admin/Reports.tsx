'use client';

import { useRouter } from 'next/navigation';
import { Button, Icon } from '@/components/ui';
import { REPORTS } from '@/lib/admin-data';
import { useAdmin } from './store';

export default function Reports() {
  const { reports, resolveReport, toast } = useAdmin();
  const router = useRouter();
  return (
    <div className="stack" style={{ gap: 10 }}>
      {REPORTS.map(([icon, color, type, where, text, by, when], i) => {
        const open = reports[i];
        return (
          <div key={i} className="a-card row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', padding: '14px 16px', borderRadius: 14, opacity: open ? 1 : .6 }}>
            <Icon name={icon} color={color} style={{ marginTop: 2 }} />
            <div className="stack" style={{ flex: '1 1 260px', gap: 4 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><span style={{ font: '600 14px var(--sans)' }}>{type}</span><span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{where}</span></div>
              <span style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>“{text}”</span>
              <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-4)' }}>{by} · {when}</span>
            </div>
            {open ? (
              <div className="row" style={{ gap: 6 }}>
                <Button variant="secondary" h={32} onClick={() => router.push('/admin/review')}>Open in review</Button>
                <Button variant="ghost" h={32} style={{ color: 'var(--success-text)' }} onClick={() => { resolveReport(i); toast('Report resolved · reporter notified'); }}>Resolve</Button>
              </div>
            ) : <span className="badge xs success" style={{ padding: '4px 8px', borderRadius: 6 }}>RESOLVED</span>}
          </div>
        );
      })}
    </div>
  );
}
