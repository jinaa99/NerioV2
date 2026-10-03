export function originMatchesHost(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host.toLowerCase() === host.toLowerCase();
  }
  catch { return false; }
}

export function originMatchesUrl(origin: string | null, url: string): boolean {
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    return (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') && parsedOrigin.origin === new URL(url).origin;
  }
  catch { return false; }
}
