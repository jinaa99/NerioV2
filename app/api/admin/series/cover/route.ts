import { and, eq, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { requireRole } from '@/server/auth/actor';
import { db } from '@/server/db/client';
import { series } from '@/server/db/schema';
import { recordAudit } from '@/server/data/audit';
import { deleteImage, isSeriesCoverKey, putSeriesCover } from '@/server/storage';
import { originMatchesUrl } from '@/server/security/origin';

export const runtime = 'nodejs';
const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  let actor;
  try { actor = await requireRole('editor'); }
  catch (cause) {
    const code = (cause as { code?: string }).code;
    return error(code === 'UNAUTHENTICATED' ? 'Sign in to upload a cover.' : 'You do not have permission to upload covers.', code === 'UNAUTHENTICATED' ? 401 : 403);
  }
  if (!originMatchesUrl(request.headers.get('origin'), request.url)) return error('Upload origin is not allowed.', 403);
  if (Number(request.headers.get('content-length') ?? 0) > 11 * 1024 * 1024) return error('Cover image must be 10 MB or smaller.', 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return error('Could not read the uploaded image.', 400); }
  const seriesId = String(form.get('seriesId') ?? '');
  const file = form.get('file');
  if (seriesId && !/^[0-9a-f-]{36}$/i.test(seriesId)) return error('Invalid series.', 400);
  if (!(file instanceof File)) return error('Choose an image to upload.', 400);
  if (file.size < 1 || file.size > 10 * 1024 * 1024) return error('Cover image must be 10 MB or smaller.', 413);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return error('Use a JPEG, PNG, or WebP image.', 415);

  if (seriesId) {
    const [row] = await db().select({ id: series.id }).from(series).where(and(eq(series.id, seriesId), isNull(series.deletedAt)));
    if (!row) return error('Series not found.', 404);
  }
  let output: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100) return error('Image must be at least 100 × 100 pixels.', 422);
    output = await sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
  } catch { return error('That file could not be decoded as an image.', 422); }

  const key = `series/${seriesId || randomUUID()}/covers/${randomUUID()}.webp`;
  try { await putSeriesCover(key, output); } catch { return error('Cover image storage failed. Try again.', 503); }
  if (seriesId) {
    let previous: string | null;
    try {
      previous = await db().transaction(async tx => {
        const [current] = await tx.select({ coverKey: series.coverKey }).from(series).where(eq(series.id, seriesId)).for('update');
        await tx.update(series).set({ coverKey: key }).where(eq(series.id, seriesId));
        await recordAudit(tx, actor, { action: 'series.cover_upload', targetType: 'series', targetId: seriesId, metadata: { bytes: output.length, format: 'webp' } });
        return current?.coverKey ?? null;
      });
    } catch {
      await deleteImage(key);
      return error('The cover could not be attached to the series. Try again.', 500);
    }
    // Remove the replaced upload once nothing references it; URL covers aren't ours to delete.
    if (previous && isSeriesCoverKey(previous)) {
      const [stillUsed] = await db().select({ id: series.id }).from(series).where(eq(series.coverKey, previous)).limit(1);
      if (!stillUsed) await deleteImage(previous);
    }
  }
  return Response.json({ coverUrl: `/api/media/${key}`, uploadKey: key });
}
