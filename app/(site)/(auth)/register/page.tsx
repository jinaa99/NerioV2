import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RegisterForm } from '@/components/site/AuthForms';
import { safeNextPath } from '@/lib/validation';
import { getCurrentActor } from '@/server/auth/actor';
import { googleEnabled } from '@/server/auth/google';

export const metadata: Metadata = { title: 'Create account' };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentActor()) redirect(next);
  return (
    <>
      <div className="stack" style={{ gap: 10 }}>
        <span className="kicker accent">Free account</span>
        <h1 style={{ font: '400 clamp(32px,5vw,44px)/1.05 var(--serif)', letterSpacing: '-.02em' }}>Create your account</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--ink-2)' }}>Save series to your library, follow updates and keep your place in every chapter.</p>
      </div>
      <RegisterForm next={next} google={googleEnabled()} />
    </>
  );
}
