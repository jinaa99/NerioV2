import 'server-only';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { serverEnv } from './env';

/**
 * Resolve a stored image reference (`series.cover_key`, `chapter_pages.source_key`) to a URL the
 * browser can load. References are either public `https://` URLs (entered by editors) or
 * object-storage keys. Object storage isn't wired up yet, so keys resolve to null and the UI
 * falls back to the generated cover gradient / an empty page slot.
 */
export function imageSrc(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('https://')) return ref;
  if (isChapterImageKey(ref)) return `/api/media/${ref}`;
  if (isSeriesCoverKey(ref)) return `/api/media/${ref}`;
  return null;
}

/** Private local provider. Deployments can replace this implementation with S3/R2 behind this API. */
export async function putImage(key: string, body: Buffer): Promise<void> {
  if (!isChapterImageKey(key) || key.includes('/delivery-')) throw new Error('Invalid source image storage key');
  const root = path.resolve(serverEnv().NERIO_STORAGE_DIR);
  const destination = path.resolve(root, key);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('Invalid storage key');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, body, { flag: 'wx', mode: 0o600 });
}

export async function putSeriesCover(key: string, body: Buffer): Promise<void> {
  if (!isSeriesCoverKey(key)) throw new Error('Invalid series cover storage key');
  const root = path.resolve(serverEnv().NERIO_STORAGE_DIR);
  const destination = path.resolve(root, key);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('Invalid storage key');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, body, { flag: 'wx', mode: 0o600 });
}

export async function putDeliveryImage(key: string, body: Buffer): Promise<void> {
  if (!/^chapters\/[a-z0-9-]+\/delivery-[0-9]{1,4}-[0-9]{1,4}(?:-[0-9]{4})?\.png$/.test(key)) throw new Error('Invalid delivery image key');
  const root = path.resolve(serverEnv().NERIO_STORAGE_DIR);
  const destination = path.resolve(root, key);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('Invalid delivery image key');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, body, { flag: 'wx', mode: 0o600 });
}

export async function deleteImage(key: string): Promise<void> {
  if (!isChapterImageKey(key) && !isSeriesCoverKey(key)) return;
  await unlink(path.resolve(serverEnv().NERIO_STORAGE_DIR, key)).catch(() => undefined);
}

export async function getImage(key: string): Promise<Buffer | null> {
  if (!isChapterImageKey(key) && !isSeriesCoverKey(key)) return null;
  return readFile(path.resolve(serverEnv().NERIO_STORAGE_DIR, key)).catch(() => null);
}

export function isChapterImageKey(key: string): boolean {
  return /^chapters\/[a-z0-9-]+\/(?:[0-9]{1,4}|delivery-[0-9]{1,4}-[0-9]{1,4}(?:-[0-9]{4})?)\.png$/.test(key);
}

export function isSeriesCoverKey(key: string): boolean {
  return /^series\/[0-9a-f-]{36}\/covers\/[0-9a-f-]{36}\.webp$/i.test(key);
}
