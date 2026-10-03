import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/admin/pipeline/*/run': ['./assets/fonts/NotoSans-Variable.ttf'],
  },
};

export default nextConfig;
