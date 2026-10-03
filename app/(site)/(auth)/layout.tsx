import { Logo } from '@/components/site/Chrome';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="stack" style={{ minHeight: '100dvh' }}>
      <header className="container row" style={{ height: 64 }}><Logo /></header>
      <main className="page-anim stack" style={{ flex: 1, width: '100%', maxWidth: 440, margin: '0 auto', padding: 'clamp(24px,6vh,72px) var(--gutter) 64px', gap: 28 }}>
        {children}
      </main>
    </div>
  );
}
