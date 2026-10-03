import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/admin/pipeline/*/run': ['./assets/fonts/*.ttf'],
    '/admin/review/*': ['./assets/fonts/*.ttf'],
  },
};

export default nextConfig;
