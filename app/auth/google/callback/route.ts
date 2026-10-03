import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { finishGoogleSignIn } from '@/server/auth/google';

/** Google redirects here with ?code&state (or ?error). */
export async function GET(request: NextRequest) {
  const result = await finishGoogleSignIn(request.nextUrl.searchParams);
  redirect(result.ok ? result.next : `/login?error=google_${result.reason}`);
}
