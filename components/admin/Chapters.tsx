'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Pager from '@/components/Pager';
import { Icon, Segmented } from '@/components/ui';
import { CHAPTER_STATUS_LABEL, CHAPTER_STATUS_TONE, chapterName, chapterNo, shortDate } from '@/lib/catalog';
import { setChapterPublishedAction } from '@/server/actions/catalog';
import type { AdminChapterRowDTO, Paged } from '@/server/data/catalog';
import { useAdmin } from './store';

export type ChapterFilter = '' | 'published' | 'scheduled' | 'draft' | 'pipeline';
const FILTERS: [ChapterFilter, string][] = [['', 'All'], ['published', 'Published'], ['scheduled', 'Scheduled'], ['draft', 'Draft'], ['pipeline', 'Pipeline']];
const smallBtn = { '--h': '30px', '--px': '10px', '--r': '7px', '--fs': '12px', borderColor: 'rgba(255,255,255,.1)' } as React.CSSProperties;

export default function Chapters({ options, series, data, status }: {
  options: { id: string; title: string }[];
  series: { id: string; title: string; slug: string } | null;
  data: Paged<AdminChapterRowDTO> | null;
  status: ChapterFilter;
}) {
  const { toast } = useAdmin();
  const router = useRouter();
  const path = usePathname();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const go = (next: { series?: string; status?: string }) => {
    const sp = new URLSearchParams();
    const sid = next.series ?? series?.id;
    const st = next.series ? '' : next.status ?? status;
    if (sid) sp.set('series', sid);
    if (st) sp.set('status', st);
    startTransition(() => router.replace(`${path}?${sp}`));
  };

  const togglePublish = (c: AdminChapterRowDTO) => {
    const publish = c.status !== 'published';
    setBusy(c.id);
    startTransition(async () => {
      const res = await setChapterPublishedAction(c.id, publish);
      setBusy(null);
      if (res.ok) {
        toast(publish ? `Chapter ${chapterNo(c.number)} ${c.publishedAt && new Date(c.publishedAt) > new Date() ? 'scheduled' : 'published'}` : `Chapter ${chapterNo(c.number)} moved to drafts`);
        router.refresh();
      } else toast(res.error, 'error', 'var(--danger)');
    });
  };

  if (options.length === 0) {
    return (
      <div className="a-card stack" style={{ padding: 48, alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <Icon name="collections_bookmark" size={28} color="var(--ink-3)" />
        <span style={{ font: '600 15px var(--sans)' }}>No series yet</span>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Chapters belong to a series. Create one first.</span>
        <Link href="/admin/series/new" className="btn btn-primary" style={{ '--h': '36px', '--fs': '13px', color: 'var(--bg)', marginTop: 6 } as React.CSSProperties}>New series</Link>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Series" className="a-select" value={series?.id ?? ''} onChange={e => go({ series: e.target.value })} style={{ maxWidth: 320 }}>
          {!series && <option value="">Choose a series</option>}
          {options.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
        <div style={{ overflowX: 'auto' }}><Segmented h={30} options={FILTERS} value={status} onChange={v => go({ status: v })} /></div>
        <div className="grow" />
        {series && <>
          <Link href={`/admin/series/${series.id}`} className="btn btn-ghost" style={{ '--h': '36px', '--fs': '13px', gap: 6 } as React.CSSProperties}><Icon name="edit" size={16} />Series details</Link>
          <Link href={`/admin/chapters/new?series=${series.id}`} className="btn btn-secondary" style={{ '--h': '36px', '--fs': '13px', gap: 6 } as React.CSSProperties}><Icon name="add" size={18} />New chapter</Link>
        </>}
      </div>

      {series && data && <>
        <div className="a-table-wrap" style={{ opacity: pending && !busy ? .6 : 1, transition: 'opacity .2s' }}>
          <table className="a-table" style={{ minWidth: 820 }}>
            <thead><tr><th>CH.</th><th>TITLE</th><th>STATUS</th><th style={{ textAlign: 'right' }}>PAGES</th><th>ACCESS</th><th>PUBLISH DATE</th><th /></tr></thead>
            <tbody>
              {data.items.map(c => {
                const key = c.scheduled ? 'scheduled' : c.status;
                const canToggle = c.status === 'draft' || c.status === 'ready' || c.status === 'published';
                return (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'var(--mono)', paddingTop: 12, paddingBottom: 12 }}>{chapterNo(c.number)}</td>
                    <td><Link href={`/admin/chapters/${c.id}`} style={{ fontWeight: 600, color: c.title ? 'var(--ink-1)' : 'var(--ink-3)' }}>{chapterName(c.number, c.title)}</Link></td>
                    <td><span className={`badge xs ${CHAPTER_STATUS_TONE[key]}`}>{CHAPTER_STATUS_LABEL[key]}</span></td>
                    <td className="num" style={{ color: c.pageCount ? undefined : 'var(--warning-text)' }}>{c.pageCount}</td>
                    <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-2)' }}>{c.access === 'early_access' ? `EARLY · FREE ${shortDate(c.freeAt).toUpperCase()}` : 'FREE'}</td>
                    <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-3)' }} suppressHydrationWarning>{c.publishedAt ? shortDate(c.publishedAt).toUpperCase() : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canToggle && (
                        <button type="button" className="btn btn-ghost" style={smallBtn} disabled={busy === c.id} onClick={() => togglePublish(c)}>
                          {busy === c.id ? <span className="spinner" /> : c.status === 'published' ? 'Unpublish' : 'Publish'}
                        </button>
                      )}
                      <Link href={`/admin/chapters/${c.id}`} className="btn btn-outline" style={{ ...smallBtn, marginLeft: 6 }}>Edit</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.items.length === 0 && (
            <div className="stack" style={{ padding: 40, alignItems: 'center', gap: 6, color: 'var(--ink-3)' }}>
              <Icon name="auto_stories" size={26} />
              {status ? 'No chapters with this status.' : `${series.title} has no chapters yet.`}
            </div>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span className="meta">{data.total} CHAPTERS</span>
          <Pager total={data.total} limit={data.limit} offset={data.offset} path={path} params={{ series: series.id, status }} />
        </div>
      </>}
    </div>
  );
}
