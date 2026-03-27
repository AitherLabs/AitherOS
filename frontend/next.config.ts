import type { NextConfig } from 'next';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: []
  },
  transpilePackages: ['geist'],
  async rewrites() {
    // next.config.ts is evaluated at server startup (pm2 restart), not build time.
    // /api/v1/* rewrite works immediately; the route handler at
    // src/app/api/v1/[...path]/route.ts takes over once the frontend is rebuilt
    // (filesystem routes have priority over afterFiles rewrites).
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
