import 'server-only';
import { headers } from 'next/headers';

/**
 * Client IP and user agent for sessions, rate limits and audit rows.
 * The IP comes from the first `x-forwarded-for` hop, which is only trustworthy behind a proxy
 * that overwrites the header (Vercel, most load balancers). Treat it as a hint, not identity.
 */
export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || null;
    return { ipAddress: ip ? ip.slice(0, 64) : null, userAgent: h.get('user-agent')?.slice(0, 500) ?? null };
  } catch {
    // Outside a request (scripts, background jobs).
    return { ipAddress: null, userAgent: null };
  }
}
