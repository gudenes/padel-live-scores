import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.169"],
  serverExternalPackages: ['pdf-parse'],
  // pdfjs-dist (loaded by pdf-parse) lazily loads `pdf.worker.mjs` at first
  // getDocument() call. Vercel's bundler doesn't auto-trace this worker file
  // because the path is constructed dynamically inside pdfjs. Explicitly
  // include it in the function deployment so `/var/task/node_modules/pdfjs-dist/...`
  // resolves correctly at runtime. See:
  //   https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats
  outputFileTracingIncludes: {
    '/api/ops/seed-fip-tournament': [
      'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
    ],
  },
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
