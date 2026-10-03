import Link from 'next/link';
import { Icon } from '@/components/ui';

/** Numbered pagination as plain links (`?page=N`), so pages are shareable and work without JS. */
export default function Pager({ total, limit, offset, path, params = {} }: {
  total: number; limit: number; offset: number; path: string; params?: Record<string, string | undefined>;
}) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;
  const current = Math.floor(offset / limit) + 1;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return qs ? `${path}?${qs}` : path;
  };
  // 1 … 4 5 [6] 7 8 … 20
  const nums = [...new Set([1, current - 2, current - 1, current, current + 1, current + 2, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const btn = { '--h': '36px', '--px': '12px', '--r': '9px', '--fs': '13px', borderColor: 'rgba(255,255,255,.1)' } as React.CSSProperties;
  return (
    <nav aria-label="Pagination" className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
      {current > 1
        ? <Link href={href(current - 1)} className="btn btn-outline" style={btn} aria-label="Previous page"><Icon name="chevron_left" size={18} /></Link>
        : <span className="btn btn-outline" style={{ ...btn, opacity: .4 }} aria-hidden><Icon name="chevron_left" size={18} /></span>}
      {nums.map((n, i) => (
        <span key={n} className="row" style={{ gap: 6 }}>
          {i > 0 && n - nums[i - 1] > 1 && <span className="meta" style={{ padding: '0 2px' }}>…</span>}
          <Link href={href(n)} aria-current={n === current ? 'page' : undefined} className={`btn ${n === current ? 'btn-primary' : 'btn-outline'}`}
            style={{ ...btn, fontFamily: 'var(--mono)', minWidth: 36, color: n === current ? 'var(--bg)' : undefined }}>{n}</Link>
        </span>
      ))}
      {current < pages
        ? <Link href={href(current + 1)} className="btn btn-outline" style={btn} aria-label="Next page"><Icon name="chevron_right" size={18} /></Link>
        : <span className="btn btn-outline" style={{ ...btn, opacity: .4 }} aria-hidden><Icon name="chevron_right" size={18} /></span>}
    </nav>
  );
}

/** `?page=` → offset, clamped to a sane range. */
export function pageOffset(page: string | string[] | undefined, limit: number) {
  const n = Math.floor(Number(Array.isArray(page) ? page[0] : page));
  return Number.isFinite(n) && n > 1 ? Math.min(n - 1, Math.floor(10_000 / limit)) * limit : 0;
}

/** First value of a search param. */
export const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
