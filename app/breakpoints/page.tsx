import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Breakpoints' };

type Frame = { src: string; w: number; h: number; label: string };
const fr = (src: string, w: number, h: number, label: string): Frame => ({ src, w, h, label: `${w} · ${label}` });

const ROWS: { title: string; frames: Frame[] }[] = [
  { title: 'Home', frames: [fr('/', 360, 780, 'small phone'), fr('/', 390, 844, 'phone'), fr('/', 768, 1024, 'tablet'), fr('/', 1024, 1100, 'small laptop'), fr('/', 1440, 1100, 'desktop'), fr('/', 1920, 1100, 'large desktop')] },
  { title: 'Series & reader', frames: [fr('/series/lantern', 390, 844, 'series'), fr('/read/lantern/112', 390, 844, 'reader'), fr('/premium', 390, 844, 'premium'), fr('/read/lantern/112', 1440, 900, 'reader'), fr('/series/lantern', 1024, 900, 'series')] },
  { title: 'Profile', frames: [fr('/profile', 390, 844, 'profile'), fr('/profile', 1440, 900, 'profile')] },
  { title: 'Admin', frames: [fr('/admin', 390, 844, 'overview'), fr('/admin/upload', 768, 1024, 'upload'), fr('/admin/review', 1440, 1000, 'translation review'), fr('/admin', 1920, 1000, 'overview')] },
];

export default function Page() {
  return (
    <div className="stack" style={{ padding: 64, gap: 72, width: 'max-content', background: '#050506', minHeight: '100vh' }}>
      <div className="stack" style={{ gap: 10 }}>
        <span className="kicker accent">Nerio · Responsive</span>
        <span style={{ font: '400 56px/1 var(--serif)' }}>Breakpoints</span>
        <span style={{ font: '400 14px var(--mono)', color: 'var(--ink-3)' }}>
          Live frames of the <Link href="/" className="ds-link">reader site</Link> and <Link href="/admin" className="ds-link">admin</Link>. Each frame is interactive.
        </span>
      </div>
      {ROWS.map(row => (
        <section key={row.title} className="stack" style={{ gap: 20 }}>
          <span style={{ font: '400 32px var(--serif)' }}>{row.title}</span>
          <div className="row" style={{ gap: 40, alignItems: 'flex-start' }}>
            {row.frames.map(f => (
              <div key={f.label + f.src} className="stack" style={{ gap: 10 }}>
                <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-2)' }}>{f.label}</span>
                <iframe src={f.src} title={f.label} loading="lazy" style={{ width: f.w, height: f.h, border: '1px solid rgba(255,255,255,.12)', borderRadius: f.w < 500 ? 28 : 12, background: 'var(--bg)', display: 'block' }} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
