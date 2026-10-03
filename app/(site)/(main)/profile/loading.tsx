import { ListSkeleton } from '@/components/site/Profile';

export default function Loading() {
  return (
    <div className="stack" style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(28px,5vw,64px) var(--gutter) 64px', gap: 'clamp(28px,4vw,44px)' }} aria-busy aria-label="Loading profile">
      <div className="row" style={{ gap: 'clamp(16px,3vw,28px)' }}>
        <div className="skeleton" style={{ width: 'clamp(72px,10vw,112px)', aspectRatio: '1', borderRadius: '50%' }} />
        <div className="stack" style={{ gap: 10, flex: 1 }}>
          <div style={{ height: 32, width: 'min(320px,70%)', borderRadius: 6, background: 'var(--s2)' }} />
          <div style={{ height: 12, width: 180, borderRadius: 4, background: 'var(--s2)' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(46%,180px),1fr))', gap: 10 }}>
        {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 86, borderRadius: 16 }} />)}
      </div>
      <ListSkeleton rows={5} />
    </div>
  );
}
