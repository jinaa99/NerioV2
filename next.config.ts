import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js starts worker threads from files inside its package, which must not be bundled.
  serverExternalPackages: ['tesseract.js'],
  outputFileTracingIncludes: {
    '/api/admin/pipeline/*/run': ['./assets/fonts/*.ttf'],
    '/api/admin/pipeline/run': ['./assets/fonts/*.ttf'],
    '/admin/review/*': ['./assets/fonts/*.ttf'],
    '/admin/translate/*': ['./assets/fonts/*.ttf'],
    '/admin/batch': ['./assets/fonts/*.ttf'],
    '/api/admin/chapters/ingest': ['./assets/fonts/*.ttf'],
  },
};

export default nextConfig;
