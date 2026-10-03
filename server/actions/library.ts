'use server';
/**
 * Server Actions for the signed-in user's library. Each derives the user from the session
 * (never from arguments) and re-validates input in the DAL.
 */
import { revalidatePath } from 'next/cache';
import { updateMyProfile } from '../data/account';
import { follow, setBookmark, unfollow } from '../data/library';
import { markNotificationsRead } from '../data/notifications';
import { clearReadingHistory } from '../data/reading';
import type { UpdateProfileInput } from '@/lib/validation';
import { DalError } from '../errors';

export type LibraryResult = { ok: true } | { ok: false; error: string; signIn?: boolean };

/** `'layout'` refreshes everything under the site layout (header badge, bookmark state). */
async function run(fn: () => Promise<unknown>, revalidate: string[] | 'layout' = []): Promise<LibraryResult> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof DalError) return { ok: false, error: err.message, signIn: err.code === 'UNAUTHENTICATED' };
    throw err;
  }
  if (revalidate === 'layout') revalidatePath('/', 'layout');
  else for (const p of revalidate) revalidatePath(p);
  return { ok: true };
}

const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export async function setBookmarkAction(seriesSlug: string, on: boolean): Promise<LibraryResult> {
  return run(() => setBookmark(seriesSlug, on === true), 'layout');
}

export async function setFollowAction(seriesSlug: string, following: boolean, notify = true): Promise<LibraryResult> {
  return run(() => (following === true ? follow(seriesSlug, notify === true) : unfollow(seriesSlug)), ['/profile', `/series/${seriesSlug}`]);
}

export async function markNotificationsReadAction(ids?: string[]): Promise<LibraryResult> {
  // The unread badge lives in the site layout.
  return run(() => markNotificationsRead(ids), 'layout');
}

export async function clearHistoryAction(): Promise<LibraryResult> {
  return run(() => clearReadingHistory(), ['/profile']);
}

export type Preferences = { emailOnNewChapter?: boolean; showActivity?: boolean };

export async function savePreferencesAction(prefs: Preferences): Promise<LibraryResult> {
  const patch = defined({ emailOnNewChapter: prefs.emailOnNewChapter, showActivity: prefs.showActivity });
  return run(async () => { if (Object.keys(patch).length) await updateMyProfile(patch); }, ['/profile']);
}

export async function saveReaderSettingsAction(settings: NonNullable<UpdateProfileInput['readerSettings']>): Promise<LibraryResult> {
  return run(() => updateMyProfile({ readerSettings: settings }));
}
