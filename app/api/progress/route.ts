import { type NextRequest } from 'next/server';
import { saveProgress } from '@/server/data/reading';
import { DalError } from '@/server/errors';

/**
 * Reader progress. A route handler rather than a Server Action so the reader can flush with
 * `navigator.sendBeacon` when the tab is hidden or closed. The session cookie (SameSite=Lax)
 * authenticates; the Origin check blocks cross-site posts.
 */
export async function POST(request: NextRequest) {
  // Same check Next.js applies to Server Actions: Origin host must match the (forwarded) host.
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch {}
    if (originHost !== host) return new Response(null, { status: 403 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 1024) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  try {
    await saveProgress({ chapterId: b.chapterId as string, pageNumber: b.pageNumber as number, pageOffset: b.pageOffset as number, percent: b.percent as number });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof DalError) {
      const status = err.code === 'UNAUTHENTICATED' ? 401 : err.code === 'NOT_FOUND' ? 404 : 400;
      return Response.json({ error: err.message }, { status });
    }
    throw err;
  }
}
