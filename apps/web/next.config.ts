import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  transpilePackages: ['@crmwhats/types'],
  output: 'standalone',
  // Required for pnpm monorepo: trace files from workspace root so node_modules
  // and shared packages are properly included in the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
