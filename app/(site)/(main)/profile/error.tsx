'use client';

import { Button, Icon } from '@/components/ui';

export default function ProfileError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto', padding: 'clamp(48px,8vw,96px) var(--gutter)', alignItems: 'center', textAlign: 'center', gap: 12 }}>
      <Icon name="cloud_off" size={34} color="var(--ink-3)" />
      <h1 style={{ font: '400 clamp(26px,4vw,36px)/1.1 var(--serif)' }}>Your library didn’t load</h1>
      <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6 }}>Something went wrong on our side or your connection dropped. Your bookmarks and progress are safe.</p>
      <Button variant="primary" icon="refresh" onClick={() => retry()} style={{ marginTop: 8 }}>Try again</Button>
    </div>
  );
}
