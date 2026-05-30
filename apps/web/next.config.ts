import type { NextConfig } from 'next';
import path from 'path';

// Backend API base for server-side proxy of /api/* requests. The web is served
// over HTTPS but the API is HTTP-only, so browser calls to the API would be
// blocked as mixed content. Next reverse-proxies /api/* server-side to the
// backend instead. Override with API_PROXY_TARGET if the backend URL changes.
const API_PROXY_TARGET =
  process.env.API_PROXY_TARGET ?? 'http://pp6qewlm9usx4rqroaxzi042.2.25.139.166.sslip.io';

const nextConfig: NextConfig = {
  transpilePackages: ['@crmwhats/types'],
  output: 'standalone',
  // Required for pnpm monorepo: trace files from workspace root so node_modules
  // and shared packages are properly included in the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_PROXY_TARGET}/api/:path*` },
    ];
  },
};

export default nextConfig;
