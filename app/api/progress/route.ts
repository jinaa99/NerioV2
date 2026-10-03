import { type NextRequest } from 'next/server';
import { saveProgress } from '@/server/data/reading';
import { DalError } from '@/server/errors';
import { originMatchesHost } from '@/server/security/origin';

/**
 * Reader progress. A route handler rather than a Server Action so the reader can flush with
 * `navigator.sendBeacon` when the tab is hidden or closed. The session cookie (SameSite=Lax)
 * authenticates; the Origin check blocks cross-site posts.
 */
export async function POST(request: NextRequest) {
  // Same check Next.js applies to Server Actions: Origin host must match the (forwarded) host.
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!originMatchesHost(origin, host)) return new Response(null, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 1024) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    if (!request.body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'));
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
