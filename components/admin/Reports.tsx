'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Pager from '@/components/Pager';
import { Button, Icon, Segmented } from '@/components/ui';
import { chapterNo, timeAgo } from '@/lib/catalog';
import { resolveReportAction } from '@/server/actions/admin';
import type { AdminReportDTO, ReportStatus } from '@/server/data/reports';
import { useAdmin } from './store';

const KIND: Record<AdminReportDTO['kind'], [string, string, string]> = {
  wrong_translation: ['translate', 'var(--warning)', 'Wrong translation'],
  missing_page: ['image_not_supported', 'var(--danger)', 'Missing page'],
  text_overflow: ['text_fields', 'var(--info)', 'Text overflow'],
  image_quality: ['blur_on', 'var(--ink-2)', 'Image quality'],
  other: ['flag', 'var(--ink-2)', 'Other'],
};

export default function Reports({ data, status }: { data: { items: AdminReportDTO[]; total: number; limit: number; offset: number }; status: ReportStatus }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const path = usePathname();
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = (r: AdminReportDTO, outcome: 'resolved' | 'dismissed') => {
    const note = prompt(outcome === 'resolved' ? 'Note for the reporter (optional)' : 'Why no change is needed (optional, sent to the reporter)');
    if (note === null) return;
    setBusy(r.id);
    start(async () => {
      const res = await resolveReportAction(r.id, outcome, note);
      setBusy(null);
      if (!res.ok) return toast(res.error, 'error', 'var(--danger)');
      toast(outcome === 'resolved' ? 'Report resolved · reporter notified' : 'Report dismissed · reporter notified');
      router.refresh();
    });
  };

  return (
    <div className="stack" style={{ gap: 10, opacity: pending && !busy ? .6 : 1 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Segmented h={30} options={[['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed']]} value={status} onChange={v => start(() => router.replace(v === 'open' ? path : `${path}?status=${v}`))} />
        <span className="meta" style={{ marginLeft: 'auto' }}>{data.total} REPORTS</span>
      </div>
      {data.items.length === 0 && (
        <div className="a-card stack" style={{ padding: 40, alignItems: 'center', gap: 8, color: 'var(--ink-3)' }}>
          <Icon name={status === 'open' ? 'task_alt' : 'flag'} size={26} />{status === 'open' ? 'No open reports. Readers can report problems from the end of each chapter.' : 'Nothing here yet.'}
        </div>
      )}
      {data.items.map(r => {
        const [icon, color, label] = KIND[r.kind];
        const where = [r.series.title.toUpperCase(), r.chapterNumber !== null ? `CH. ${chapterNo(r.chapterNumber)}` : null, r.pageNumber ? `P. ${r.pageNumber}` : null].filter(Boolean).join(' · ');
        const open = r.status === 'open';
        return (
          <div key={r.id} className="a-card row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', padding: '14px 16px', borderRadius: 14, opacity: busy === r.id ? .5 : open ? 1 : .75 }}>
            <Icon name={icon} color={color} style={{ marginTop: 2 }} />
            <div className="stack" style={{ flex: '1 1 260px', gap: 4, minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><span style={{ font: '600 14px var(--sans)' }}>{label}</span><span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{where}</span></div>
              <span style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>“{r.message}”</span>
              <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-4)' }} suppressHydrationWarning>{r.reporter ? `@${r.reporter}` : 'Deleted user'} · {timeAgo(r.createdAt)}</span>
              {!open && r.resolutionNote && <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Note: {r.resolutionNote}</span>}
            </div>
            {open ? (
              <div className="row" style={{ gap: 6 }}>
                <Link href={r.chapterNumber !== null ? `/read/${r.series.slug}/${chapterNo(r.chapterNumber)}` : `/series/${r.series.slug}`} target="_blank" className="btn btn-secondary" style={{ '--h': '32px', '--fs': '13px', '--px': '12px' } as React.CSSProperties}>Open</Link>
                <Button variant="ghost" h={32} disabled={busy !== null} onClick={() => close(r, 'dismissed')}>Dismiss</Button>
                <Button variant="ghost" h={32} disabled={busy !== null} style={{ color: 'var(--success-text)' }} onClick={() => close(r, 'resolved')}>Resolve</Button>
              </div>
            ) : <span className={`badge xs ${r.status === 'resolved' ? 'success' : 'neutral'}`} style={{ padding: '4px 8px', borderRadius: 6 }}>{r.status.toUpperCase()}</span>}
          </div>
        );
      })}
      <Pager total={data.total} limit={data.limit} offset={data.offset} path={path} params={{ status: status === 'open' ? undefined : status }} />
    </div>
  );
}
