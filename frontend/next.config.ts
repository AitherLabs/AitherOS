import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: []
  },
  transpilePackages: ['geist']
};

export default nextConfig;
