'use server';
import { saveProgress } from '../data/reading';
import { DalError } from '../errors';

/** Called by the reader while scrolling (debounced). Silently ignored for signed-out readers. */
export async function saveProgressAction(chapterId: string, pageNumber: number, percent: number): Promise<{ ok: boolean }> {
  try {
    await saveProgress({ chapterId, pageNumber, percent });
    return { ok: true };
  } catch (err) {
    if (err instanceof DalError) return { ok: false };
    throw err;
  }
}
