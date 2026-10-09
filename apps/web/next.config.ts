import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Only browser-safe workspace packages. @stumps/game-engines is server-only
  // and must never be listed here (enforced by tests/unit/dependency-boundaries).
  transpilePackages: ['@stumps/contracts', '@stumps/ui'],
  images: {
    // No arbitrary remote image optimization (UI spec §7). Controlled storage
    // origins are added explicitly when the media pipeline lands.
    remotePatterns: [],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
