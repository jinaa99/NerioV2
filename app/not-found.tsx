import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="stack" style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
      <span className="kicker accent">404</span>
      <h1 style={{ font: '400 clamp(32px,5vw,52px)/1.05 var(--serif)' }}>This page wandered off</h1>
      <p style={{ color: 'var(--ink-2)' }}>The series or chapter you’re looking for doesn’t exist.</p>
      <Link href="/" className="btn btn-primary" style={{ marginTop: 8 }}>Back to Nerio</Link>
    </main>
  );
}
