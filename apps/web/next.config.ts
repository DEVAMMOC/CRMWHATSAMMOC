import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@crmwhats/types'],
  output: 'standalone',
};

export default nextConfig;
