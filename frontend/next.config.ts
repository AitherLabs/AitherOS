import type { NextConfig } from 'next';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: []
  },
  transpilePackages: ['geist'],
  async rewrites() {
    // /api/v1/* is handled by src/app/api/v1/[...path]/route.ts at request time.
    // Rewrites here cover paths that Next.js route handlers can't proxy (WebSocket)
    // and static assets served directly by the backend.
    return [
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
