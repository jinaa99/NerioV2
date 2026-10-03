import 'server-only';
import { headers } from 'next/headers';

/**
 * Client IP and user agent for sessions, rate limits and audit rows.
 * Prefer the proxy-provided `x-real-ip`; otherwise use the final `x-forwarded-for` hop, which is
 * the edge address when the deployment proxy appends the actual client address. Treat it as a
 * rate-limit hint, not identity, and configure the trusted proxy to overwrite/append these fields.
 */
export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for')?.split(',').map(value => value.trim()).filter(Boolean);
    const ip = h.get('x-real-ip')?.trim() || forwarded?.at(-1) || null;
    return { ipAddress: ip ? ip.slice(0, 64) : null, userAgent: h.get('user-agent')?.slice(0, 500) ?? null };
  } catch {
    // Outside a request (scripts, background jobs).
    return { ipAddress: null, userAgent: null };
  }
}
