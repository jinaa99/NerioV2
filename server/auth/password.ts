import 'server-only';
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (Node built-in, memory-hard).
 * Parameters follow OWASP's scrypt guidance (N=2^15, r=8, p=3 ≈ 32 MiB per hash).
 * Stored as `scrypt$N$r$p$salt$hash` (base64url) so parameters can be raised later
 * and old hashes still verify; `needsRehash` flags them for upgrade on next login.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LEN = 64;
const SALT_LEN = 16;

function derive(password: string, salt: Buffer, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...opts, maxmem: 128 * opts.N * opts.r * 2 };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isSafeInteger) || N > 2 ** 20 || r > 32 || p > 16) return false;
  const expected = Buffer.from(parts[5], 'base64url');
  const actual = await derive(password, Buffer.from(parts[4], 'base64url'), { N, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function needsRehash(stored: string): boolean {
  const [, N, r, p] = stored.split('$');
  return Number(N) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p;
}

// Verifying against a throwaway hash when the email is unknown keeps response times equal,
// so timing doesn't reveal which emails have accounts.
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummy, password);
}
