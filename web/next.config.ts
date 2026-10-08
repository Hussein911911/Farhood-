import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ['*.e2b.app'],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
