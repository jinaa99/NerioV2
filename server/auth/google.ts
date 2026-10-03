import 'server-only';
/**
 * Sign in with Google: OpenID Connect authorization-code flow with PKCE, state and nonce.
 * No SDK. The ID token comes straight from Google's token endpoint over TLS, which OIDC
 * accepts in place of a signature check (Core §3.1.3.7); we still validate iss/aud/exp/nonce.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { safeNextPath } from '@/lib/validation';
import { db } from '../db/client';
import { oauthAccounts, profiles, roles, sessions, userRoles, users } from '../db/schema';
import { googleOAuthConfig } from '../env';
import { uniqueViolation } from '../errors';
import { startFreshSession } from './service';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const production = process.env.NODE_ENV === 'production';
const FLOW_COOKIE = production ? '__Host-nerio_oauth' : 'nerio_oauth';
const FLOW_TTL_S = 10 * 60;

const b64url = (buf: Buffer) => buf.toString('base64url');
const random = () => b64url(randomBytes(32));
const sameString = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const flowSchema = z.object({ state: z.string(), verifier: z.string(), nonce: z.string(), next: z.string() });

export const googleEnabled = () => googleOAuthConfig() !== null;

/** Begin the flow: remember state/PKCE/nonce in a short-lived httpOnly cookie, return Google's consent URL. */
export async function startGoogleSignIn(nextParam: unknown): Promise<string | null> {
  const config = googleOAuthConfig();
  if (!config) return null;
  const flow = { state: random(), verifier: random(), nonce: random(), next: safeNextPath(nextParam) };
  (await cookies()).set(FLOW_COOKIE, b64url(Buffer.from(JSON.stringify(flow))), {
    httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: FLOW_TTL_S,
  });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: b64url(createHash('sha256').update(flow.verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export type GoogleResult = { ok: true; next: string } | { ok: false; reason: 'cancelled' | 'expired' | 'failed' | 'unverified' | 'suspended' | 'conflict' | 'unavailable' };

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  sub: z.string().min(1).max(255),
  nonce: z.string().optional(),
  email: z.email().max(320),
  email_verified: z.union([z.boolean(), z.literal('true'), z.literal('false')]),
  name: z.string().optional(),
  given_name: z.string().optional(),
});
type Claims = z.infer<typeof claimsSchema>;

/** Finish the flow on /auth/google/callback. Never throws for user-facing failures. */
export async function finishGoogleSignIn(params: URLSearchParams): Promise<GoogleResult> {
  const config = googleOAuthConfig();
  if (!config) return { ok: false, reason: 'unavailable' };

  const store = await cookies();
  const raw = store.get(FLOW_COOKIE)?.value;
  store.set(FLOW_COOKIE, '', { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: 0 });
  let flow: z.infer<typeof flowSchema>;
  try {
    flow = flowSchema.parse(JSON.parse(Buffer.from(raw ?? '', 'base64url').toString()));
  } catch {
    return { ok: false, reason: 'expired' };
  }
  // CSRF / login-CSRF: the callback must belong to a flow this browser started.
  const state = params.get('state') ?? '';
  if (!sameString(state, flow.state)) return { ok: false, reason: 'expired' };
  if (params.get('error')) return { ok: false, reason: 'cancelled' };
  const code = params.get('code');
  if (!code) return { ok: false, reason: 'failed' };

  let claims: Claims;
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri,
        grant_type: 'authorization_code', code_verifier: flow.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, reason: 'failed' };
    const { id_token } = z.object({ id_token: z.string() }).parse(await res.json());
    const payload = id_token.split('.')[1];
    claims = claimsSchema.parse(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()));
  } catch {
    return { ok: false, reason: 'failed' };
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ISSUERS.has(claims.iss) || !audiences.includes(config.clientId) || claims.exp * 1000 < Date.now()) return { ok: false, reason: 'failed' };
  if (!claims.nonce || !sameString(claims.nonce, flow.nonce)) return { ok: false, reason: 'failed' };
  if (claims.email_verified !== true && claims.email_verified !== 'true') return { ok: false, reason: 'unverified' };

  let outcome: { userId: string } | { reason: 'suspended' | 'conflict' };
  try {
    outcome = await resolveUser(claims);
  } catch (err) {
    // Two first-time sign-ins racing for the same email/username: the retry finds the winner's row.
    if (uniqueViolation(err) === null) throw err;
    outcome = await resolveUser(claims);
  }
  if ('reason' in outcome) return { ok: false, reason: outcome.reason };
  await startFreshSession(outcome.userId);
  return { ok: true, next: flow.next };
}

const usernameBase = (email: string) => {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_.]/g, '').replace(/^\.+|\.+$/g, '').slice(0, 24);
  return local.length >= 3 ? local : `reader${local}`;
};

/** Map a verified Google identity to a user: existing link → linked user; same email → link; else create. */
async function resolveUser(claims: Claims): Promise<{ userId: string } | { reason: 'suspended' | 'conflict' }> {
  const email = claims.email.trim().toLowerCase();
  return db().transaction(async tx => {
    const now = new Date();
    const [linked] = await tx
      .select({ userId: oauthAccounts.userId, status: users.status, deletedAt: users.deletedAt })
      .from(oauthAccounts).innerJoin(users, eq(users.id, oauthAccounts.userId))
      .where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerUserId, claims.sub)));
    if (linked) {
      if (linked.status !== 'active' || linked.deletedAt) return { reason: 'suspended' as const };
      await tx.update(oauthAccounts).set({ lastUsedAt: now, email }).where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerUserId, claims.sub)));
      await tx.update(users).set({ lastSeenAt: now }).where(eq(users.id, linked.userId));
      return { userId: linked.userId };
    }

    const [existing] = await tx
      .select({ id: users.id, status: users.status, deletedAt: users.deletedAt, emailVerifiedAt: users.emailVerifiedAt })
      .from(users).where(eq(sql`lower(${users.email})`, email));
    if (existing) {
      if (existing.status !== 'active' || existing.deletedAt) return { reason: 'suspended' as const };
      const [other] = await tx.select({ id: oauthAccounts.providerUserId }).from(oauthAccounts)
        .where(and(eq(oauthAccounts.userId, existing.id), eq(oauthAccounts.provider, 'google')));
      if (other) return { reason: 'conflict' as const };
      await tx.insert(oauthAccounts).values({ provider: 'google', providerUserId: claims.sub, userId: existing.id, email });
      if (!existing.emailVerifiedAt) {
        // The password account was never proven to own this inbox; Google just proved it.
        // Drop that password and its sessions so whoever pre-registered the address loses access.
        await tx.update(users).set({ passwordHash: null, emailVerifiedAt: now, lastSeenAt: now }).where(eq(users.id, existing.id));
        await tx.delete(sessions).where(eq(sessions.userId, existing.id));
      } else {
        await tx.update(users).set({ lastSeenAt: now }).where(eq(users.id, existing.id));
      }
      return { userId: existing.id };
    }

    const [user] = await tx.insert(users).values({ email, emailVerifiedAt: now, lastSeenAt: now }).returning({ id: users.id });
    const base = usernameBase(email);
    let username = base;
    for (let i = 0; i < 6; i++) {
      const [taken] = await tx.select({ id: profiles.userId }).from(profiles).where(eq(sql`lower(${profiles.username})`, username));
      if (!taken) break;
      username = `${base.slice(0, 26)}${randomBytes(3).readUIntBE(0, 3) % 1_000_000}`;
    }
    const displayName = (claims.name ?? claims.given_name ?? email.split('@')[0]).trim().slice(0, 64) || 'Reader';
    await tx.insert(profiles).values({ userId: user.id, username, displayName });
    const [reader] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, 'reader'));
    if (!reader) throw new Error('Role "reader" is missing. Run the database migrations.');
    await tx.insert(userRoles).values({ userId: user.id, roleId: reader.id });
    await tx.insert(oauthAccounts).values({ provider: 'google', providerUserId: claims.sub, userId: user.id, email });
    return { userId: user.id };
  });
}
