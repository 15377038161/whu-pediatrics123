import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Clinical assets are mounted privately at runtime, never bundled as application files.
  outputFileTracingExcludes: { '*': ['./knowledge/**/*'] },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
