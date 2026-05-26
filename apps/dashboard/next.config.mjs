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
      // OAuth는 /api 아래가 아님 → 별도 proxy (학습자 [Slack 인증하기] 버튼용)
      { source: '/oauth/:path*', destination: `${runtime}/oauth/:path*` },
    ];
  },
};

export default nextConfig;
