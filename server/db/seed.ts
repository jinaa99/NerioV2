/**
 * Development seed: loads the frontend's mock catalog (lib/data.ts) into the database.
 * Run with `npm run db:seed` after `npm run db:migrate`. Idempotent; refuses to run in production.
 * Runs under plain Node (tsx), so it uses the schema directly instead of the server-only DAL.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { GENRES, SERIES } from '../../lib/data';
import * as schema from './schema';

try {
  process.loadEnvFile('.env.local');
} catch {
  // Fall back to the shell environment.
}

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database.');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });
const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const parseCount = (s: string) => Math.round(parseFloat(s) * (s.endsWith('M') ? 1e6 : s.endsWith('K') ? 1e3 : 1));
const DAY = 86_400_000;

async function main() {
  const genreNames = new Set([...GENRES.map(g => g[0]), ...SERIES.flatMap(s => s.genres)]);
  const hueByGenre = new Map(GENRES.map(([name, , h]) => [name, h]));
  await db.insert(schema.genres)
    .values([...genreNames].map(name => ({ name, slug: toSlug(name), hue: hueByGenre.get(name) ?? 0 })))
    .onConflictDoNothing();
  const genreRows = await db.select({ id: schema.genres.id, name: schema.genres.name }).from(schema.genres);
  const genreId = new Map(genreRows.map(g => [g.name, g.id]));

  for (const s of SERIES) {
    const [row] = await db.insert(schema.series).values({
      slug: s.id, title: s.title, altTitle: s.alt, description: s.desc, author: s.author, artist: s.artist,
      status: s.status.toLowerCase() as 'ongoing' | 'completed' | 'hiatus' | 'draft',
      coverHue: s.hue, ratingAvg: s.rating, ratingCount: parseCount(s.votes),
      viewCount: parseCount(s.reads), followerCount: parseCount(s.followers), publishedAt: new Date(),
    }).onConflictDoUpdate({ target: schema.series.slug, set: { title: s.title } }).returning({ id: schema.series.id });

    await db.insert(schema.seriesGenres)
      .values(s.genres.map((g, position) => ({ seriesId: row.id, genreId: genreId.get(g)!, position })))
      .onConflictDoNothing();

    const now = Date.now();
    const free = s.ch - s.early;
    await db.insert(schema.chapters).values(Array.from({ length: s.ch }, (_, i) => {
      const n = i + 1;
      const early = n > free;
      return {
        seriesId: row.id, number: n, status: 'published' as const, pageCount: 0,
        access: early ? 'early_access' as const : 'free' as const,
        freeAt: early ? new Date(now + (n - free) * 7 * DAY) : null,
        publishedAt: new Date(now - (s.ch - n) * 7 * DAY),
      };
    })).onConflictDoNothing();
  }
  console.log(`Seeded ${genreNames.size} genres and ${SERIES.length} series.`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
