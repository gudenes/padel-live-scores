import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.169"],
  serverExternalPackages: ['pdf-parse'],
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/fantasypadeltour/**',
      },
      {
        protocol: 'https',
        hostname: 'jwqaesjjoghzobngxejn.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.padelfip.com',
        pathname: '/wp-content/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
