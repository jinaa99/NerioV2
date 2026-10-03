'use server';
/**
 * Server Actions for the auth and account forms. Each one re-validates everything server-side
 * and reads only the fields it expects from FormData, so extra fields (a forged `userId`,
 * `role`, …) are ignored. Next.js rejects cross-origin Server Action posts (Origin vs Host).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/validation';
import { requireActor } from '../auth/actor';
import { login, logout, register } from '../auth/service';
import { destroyUserSessions } from '../auth/session';
import { updateMyProfile } from '../data/account';
import { DalError } from '../errors';

export type FormState = {
  error?: string;
  fields?: Record<string, string[]>;
  /** Echo of non-secret inputs so the form keeps them after an error. */
  values?: Record<string, string>;
  ok?: boolean;
};

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
};

function toState(err: unknown, values?: Record<string, string>): FormState {
  if (err instanceof DalError) return { error: err.message, fields: err.fields, values };
  throw err;
}

export async function registerAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = { displayName: str(fd, 'displayName'), username: str(fd, 'username'), email: str(fd, 'email') };
  try {
    await register({ ...values, password: str(fd, 'password') });
  } catch (err) {
    return toState(err, values);
  }
  const next = safeNextPath(str(fd, 'next'));
  redirect(next === '/' ? '/profile' : next);
}

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = { email: str(fd, 'email') };
  try {
    await login({ email: values.email, password: str(fd, 'password') });
  } catch (err) {
    return toState(err, values);
  }
  redirect(safeNextPath(str(fd, 'next')));
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect('/');
}

/** "Sign out everywhere": ends every other session; this device stays signed in. */
export async function logoutOtherDevicesAction(): Promise<{ count: number }> {
  const actor = await requireActor();
  const count = await destroyUserSessions(actor.userId, actor.sessionId);
  return { count };
}

export async function updateAccountAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = { displayName: str(fd, 'displayName'), username: str(fd, 'username') };
  try {
    await updateMyProfile(values);
  } catch (err) {
    return toState(err, values);
  }
  revalidatePath('/', 'layout');
  return { ok: true, values };
}
