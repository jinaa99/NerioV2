import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/auth', '/profile', '/breakpoints', '/design-system'],
    },
    sitemap: new URL('/sitemap.xml', base).toString(),
  };
}
