import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { startGoogleSignIn } from '@/server/auth/google';

/** GET /auth/google?next=/somewhere → Google's account chooser. */
export async function GET(request: NextRequest) {
  const url = await startGoogleSignIn(request.nextUrl.searchParams.get('next'));
  redirect(url ?? '/login?error=google_unavailable');
}
