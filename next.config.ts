import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

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
  // PostHog reverse proxy — same goal as Sentry's tunnelRoute: send analytics
  // through our own domain so ad-blockers (uBlock Origin, Brave Shields, etc.)
  // don't shadow-block direct posthog.com URLs. /ingest/decide is hot path for
  // feature flags so it gets its own static rewrite for clarity.
  //
  // Skipping i18n on /ingest/* is handled in src/proxy.ts.
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ]
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
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
        pathname: '/9.x/**',
      },
    ],
  },
};

// Compose: Sentry plugin wraps the next-intl plugin which wraps the
// raw config. Sentry's wrapper handles source-map upload at build
// time so production stack traces are readable. It's a no-op when
// SENTRY_AUTH_TOKEN is unset (local dev / PR previews) — won't fail
// the build, just skips upload.
export default withSentryConfig(withNextIntl(nextConfig), {
  // Read from env so the same config works for any Sentry org/project.
  // All four env vars are optional: missing any of them disables source
  // map upload but keeps the runtime SDK working.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Silent in dev / when auth missing; emits the upload progress when
  // it actually has something to do.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Hide source-map files from the deployed bundle so they're only
  // visible to Sentry, not random visitors.
  widenClientFileUpload: true,
  // Tunnel route through our own domain to bypass ad-blockers that
  // block sentry.io. Required for accurate front-end error capture
  // — most ad-blockers shadow-drop direct ingest URLs.
  tunnelRoute: '/monitoring',
  // Disable the "test that errors get to Sentry" auto-injected page.
  // We'll smoke-test ourselves the first time we wire in a real DSN.
  disableLogger: true,
});
