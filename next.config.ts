import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Clinical assets are mounted privately at runtime, never bundled as application files.
  outputFileTracingExcludes: { '*': ['./knowledge/**/*'] },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
    // Build-time static collection worker count. Next defaults to os.cpus().length - 1,
    // which yields 63 workers in this 64-thread sandbox (2-core cgroup quota, 6GiB memory
    // limit, no swap). 63 concurrent workers reliably exhaust the memcg limit during
    // "Collecting page data" (exit 137 / SIGKILL by memcg OOM killer). Cap to 2 workers,
    // matching the actual CPU quota, to bound peak memory. No effect at runtime.
    cpus: 2,
  },
};

export default nextConfig;
