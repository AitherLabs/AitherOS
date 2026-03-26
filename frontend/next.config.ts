import type { NextConfig } from 'next';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: []
  },
  transpilePackages: ['geist'],
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${BACKEND}/api/v1/:path*`,
      },
      {
        source: '/ws/:path*',
        destination: `${BACKEND}/ws/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${BACKEND}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
