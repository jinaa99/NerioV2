import { type NextRequest } from 'next/server';
import { listPublicChapters } from '@/server/data/catalog';
import { DalError } from '@/server/errors';

/** Paged chapter list for the series page ("Show more", search, sort, unread filter). */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/series/[slug]/chapters'>) {
  const { slug } = await params;
  const sp = request.nextUrl.searchParams;
  const num = (k: string) => (sp.get(k) === null || sp.get(k) === '' ? undefined : Number(sp.get(k)));
  const after = num('after');
  try {
    const data = await listPublicChapters(slug, {
      offset: num('offset'),
      limit: num('limit'),
      order: sp.get('order') === 'asc' ? 'asc' : 'desc',
      q: sp.get('q')?.slice(0, 100) || undefined,
      after: after !== undefined && Number.isFinite(after) ? after : undefined,
    });
    if (!data) return Response.json({ error: 'Not found' }, { status: 404 });
    // Lock state depends on the viewer, so never share this response between users.
    return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof DalError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
