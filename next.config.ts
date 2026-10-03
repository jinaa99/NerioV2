import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/admin/pipeline/*/run': ['./assets/fonts/NotoSans-Variable.ttf'],
    '/admin/review/*': ['./assets/fonts/NotoSans-Variable.ttf'],
  },
};

export default nextConfig;
