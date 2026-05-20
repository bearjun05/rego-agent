/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  async rewrites() {
    const runtime = process.env.RUNTIME_URL ?? 'http://localhost:3001';
    return [
      // 대시보드 → 런타임 API proxy
      { source: '/api/runtime/:path*', destination: `${runtime}/api/:path*` },
      { source: '/api/runtime-events', destination: `${runtime}/api/events` },
    ];
  },
};

export default nextConfig;
