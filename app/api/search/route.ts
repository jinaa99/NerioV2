import { type NextRequest } from 'next/server';
import { slug } from '@/lib/validation';
import { listSeries } from '@/server/data/catalog';

/** Typeahead for the search overlay. Public series only; same filters as /browse. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim().slice(0, 100);
  const genre = slug.safeParse(sp.get('genre')).data;
  const data = await listSeries({ q: q || undefined, genre, sort: q ? 'popular' : 'updated', limit: 8 });
  return Response.json({
    total: data.total,
    items: data.items.map(s => ({
      slug: s.slug, title: s.title, author: s.author, coverHue: s.coverHue, coverUrl: s.coverUrl,
      genres: s.genres.map(g => g.name), latestChapter: s.latestChapter,
    })),
  }, { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' } });
}
