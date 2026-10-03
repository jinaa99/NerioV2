import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/site/AuthForms';
import { safeNextPath } from '@/lib/validation';
import { getCurrentActor } from '@/server/auth/actor';
import { googleEnabled } from '@/server/auth/google';

// Only known codes map to text, so the query string can't inject arbitrary messages.
const NOTICES: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_expired: 'That sign-in link expired. Please try again.',
  google_failed: 'We couldn’t sign you in with Google. Please try again.',
  google_unverified: 'Your Google account’s email isn’t verified yet.',
  google_suspended: 'This account is suspended. Contact support.',
  google_conflict: 'This email is already linked to a different Google account.',
  google_unavailable: 'Google sign-in isn’t available right now.',
};

export const metadata: Metadata = { title: 'Sign in' };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const notice = typeof params.error === 'string' && Object.hasOwn(NOTICES, params.error) ? NOTICES[params.error] : undefined;
  if (await getCurrentActor()) redirect(next);
  return (
    <>
      <div className="stack" style={{ gap: 10 }}>
        <span className="kicker accent">Welcome back</span>
        <h1 style={{ font: '400 clamp(32px,5vw,44px)/1.05 var(--serif)', letterSpacing: '-.02em' }}>Sign in to Nerio</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--ink-2)' }}>Pick up where you left off. Your library and progress sync across devices.</p>
      </div>
      <LoginForm next={next} google={googleEnabled()} notice={notice} />
    </>
  );
}
