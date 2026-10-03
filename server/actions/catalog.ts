'use server';
/**
 * Server Actions behind the admin content editor. Each reads only the fields it expects from
 * FormData; the DAL re-validates and enforces the editor role (admin ⊇ editor).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addPages, createChapter, createSeries, deleteChapter, deletePage, deleteSeries, reorderPages, seriesSlugForChapter,
  setChapterPublished, updateChapter, updateSeries,
} from '../data/catalog';
import { DalError } from '../errors';
import type { FormState } from './auth';

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
};
const lines = (v: string) => v.split('\n').map(s => s.trim()).filter(Boolean);
const list = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean);
const optional = (v: string) => (v.trim() === '' ? null : v.trim());

function toState(err: unknown, values?: Record<string, string>): FormState {
  if (err instanceof DalError) return { error: err.message, fields: err.fields, values };
  throw err;
}

/** Public pages read straight from the database per request; this drops any client router cache. */
function revalidateCatalog(...paths: string[]) {
  revalidatePath('/', 'layout');
  for (const p of paths) revalidatePath(p);
}

export type ActionResult = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof DalError) return { ok: false, error: err.message };
    throw err;
  }
}

/* Series */

function seriesFromForm(fd: FormData) {
  const values = {
    title: str(fd, 'title'), slug: str(fd, 'slug'), altTitles: str(fd, 'altTitles'), description: str(fd, 'description'),
    author: str(fd, 'author'), artist: str(fd, 'artist'), status: str(fd, 'status'), sourceLanguage: str(fd, 'sourceLanguage'),
    coverUrl: str(fd, 'coverUrl'), coverHue: str(fd, 'coverHue'), genres: str(fd, 'genres'), tags: str(fd, 'tags'),
  };
  const input = {
    title: values.title,
    slug: values.slug,
    altTitles: lines(values.altTitles),
    description: values.description,
    author: values.author,
    artist: optional(values.artist),
    status: values.status as 'draft',
    sourceLanguage: values.sourceLanguage || 'ko',
    coverUrl: optional(values.coverUrl),
    coverHue: Number(values.coverHue) || 0,
    genres: list(values.genres),
    tags: list(values.tags),
  };
  return { values, input };
}

export async function createSeriesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { values, input } = seriesFromForm(fd);
  let id: string;
  try {
    id = (await createSeries(input)).id;
  } catch (err) {
    return toState(err, values);
  }
  revalidateCatalog('/admin/series');
  redirect(`/admin/series/${id}?saved=1`);
}

export async function updateSeriesAction(seriesId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { values, input } = seriesFromForm(fd);
  try {
    const res = await updateSeries(seriesId, input);
    revalidateCatalog('/admin/series', `/series/${res.slug}`, `/series/${res.previousSlug}`);
  } catch (err) {
    return toState(err, values);
  }
  return { ok: true, values };
}

export async function deleteSeriesAction(seriesId: string): Promise<ActionResult> {
  const res = await run(async () => {
    const { slug } = await deleteSeries(seriesId);
    revalidateCatalog('/admin/series', `/series/${slug}`);
  });
  if (res.ok) redirect('/admin/series');
  return res;
}

/* Chapters */

function chapterFromForm(fd: FormData) {
  const values = {
    number: str(fd, 'number'), title: str(fd, 'title'), access: str(fd, 'access'), freeAt: str(fd, 'freeAt'),
    status: str(fd, 'status'), publishedAt: str(fd, 'publishedAt'),
  };
  const input = {
    number: values.number.trim() === '' ? NaN : Number(values.number),
    title: optional(values.title),
    access: values.access as 'free',
    // The client converts datetime-local values to ISO strings (with the editor's timezone) before submitting.
    freeAt: optional(values.freeAt),
    status: values.status as 'draft',
    publishedAt: optional(values.publishedAt),
  };
  return { values, input };
}

export async function createChapterAction(seriesId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { values, input } = chapterFromForm(fd);
  let id: string;
  try {
    id = (await createChapter({ seriesId, ...input })).id;
  } catch (err) {
    return toState(err, values);
  }
  revalidateCatalog('/admin/chapters');
  redirect(`/admin/chapters/${id}?saved=1`);
}

export async function updateChapterAction(chapterId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { values, input } = chapterFromForm(fd);
  try {
    await updateChapter(chapterId, input);
  } catch (err) {
    return toState(err, values);
  }
  const s = await seriesSlugForChapter(chapterId);
  revalidateCatalog('/admin/chapters', ...(s ? [`/series/${s.slug}`] : []));
  return { ok: true, values };
}

export async function setChapterPublishedAction(chapterId: string, published: boolean): Promise<ActionResult> {
  return run(async () => {
    await setChapterPublished(chapterId, published);
    revalidateCatalog('/admin/chapters');
  });
}

export async function deleteChapterAction(chapterId: string): Promise<ActionResult> {
  const s = await seriesSlugForChapter(chapterId).catch(() => null);
  const res = await run(async () => {
    await deleteChapter(chapterId);
    revalidateCatalog('/admin/chapters');
  });
  if (res.ok) redirect(s ? `/admin/chapters?series=${s.seriesId}` : '/admin/chapters');
  return res;
}

/* Pages */

export async function addPagesAction(chapterId: string, pages: { url: string; width: number; height: number }[]): Promise<ActionResult> {
  return run(async () => {
    await addPages({ chapterId, pages });
    revalidatePath(`/admin/chapters/${chapterId}`);
  });
}

export async function reorderPagesAction(chapterId: string, pageIds: string[]): Promise<ActionResult> {
  return run(async () => {
    await reorderPages({ chapterId, pageIds });
    revalidatePath(`/admin/chapters/${chapterId}`);
  });
}

export async function deletePageAction(pageId: string): Promise<ActionResult> {
  return run(async () => {
    const { chapterId } = await deletePage(pageId);
    revalidatePath(`/admin/chapters/${chapterId}`);
  });
}
