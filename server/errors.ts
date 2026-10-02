import 'server-only';
import type { z } from 'zod';

export type DalErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT';

/** Expected, user-safe failures from the data layer. Messages may be shown to users; never put internals in them. */
export class DalError extends Error {
  constructor(
    readonly code: DalErrorCode,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'DalError';
  }
}

/** Validate untrusted input at the DAL boundary. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  throw new DalError('INVALID_INPUT', 'Some fields are invalid.', fields);
}

/** Postgres unique violation → CONFLICT. Anything else is rethrown untouched. */
export function rethrowUnique(err: unknown, message: string): never {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (code === '23505') throw new DalError('CONFLICT', message);
  throw err;
}
