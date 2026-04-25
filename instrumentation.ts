// instrumentation.ts
//
// Next.js 16 server-side instrumentation entry point. Called once when
// a new server instance starts, before any request is handled.
//
// We init Sentry inline rather than splitting per-runtime into separate
// `sentry.server.config.ts` / `sentry.edge.config.ts` files because:
//   1. The dynamic-import-by-relative-path pattern those files use was
//      flaky under turbopack — module resolution couldn't find the
//      sibling files even though they existed.
//   2. Both runtimes share 95% of the same config; the duplication
//      isn't worth two extra files.
//
// Both inits are no-ops when SENTRY_DSN is unset (the SDK silently
// returns from `init()` when DSN is missing). That keeps this file
// safe in local dev and on PR previews even before the user wires up
// the Sentry project — the wrapped `withSentryConfig` plugin in
// next.config.ts is also a no-op when DSN is missing.
//
// `onRequestError` is the Next.js 16 hook for app-router server errors
// that don't bubble up to a route handler (e.g. errors thrown inside
// Server Components, Server Actions, or generateStaticParams). Sentry
// provides a typed helper that handles the contextual enrichment.

import * as Sentry from '@sentry/nextjs'

/**
 * Whether Sentry should actually emit traffic. Mirrored on the client
 * via the same env-var convention. False in local / unit-test runs so
 * we don't pollute the project with dev errors.
 */
function sentryEnabled(): boolean {
  if (!process.env.SENTRY_DSN) return false
  if (process.env.SENTRY_FORCE_ENABLED === '1') return true
  return (
    process.env.VERCEL_ENV === 'production'
    || process.env.VERCEL_ENV === 'preview'
  )
}

function commonInit() {
  return {
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT
      ?? process.env.VERCEL_ENV
      ?? process.env.NODE_ENV
      ?? 'development',
    release:
      process.env.SENTRY_RELEASE
      ?? process.env.VERCEL_GIT_COMMIT_SHA
      ?? undefined,
    // GDPR-friendly default. The SDK never auto-attaches client IPs
    // or sensitive headers (Authorization / Cookie) when this is off.
    sendDefaultPii: false,
    // 10% perf sampling — meaningful coverage at low quota cost.
    // Errors aren't sampled (Sentry captures 100% of errors regardless).
    tracesSampleRate: 0.1,
    enabled: sentryEnabled(),
    // Suppress Next.js control-flow throws that aren't actually errors.
    // Filtering at the SDK level so they never count against quota.
    ignoreErrors: [
      'NEXT_REDIRECT',
      'NEXT_NOT_FOUND',
      'ResizeObserver loop',
    ],
  }
}

export async function register() {
  if (!process.env.SENTRY_DSN) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init(commonInit())
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(commonInit())
  }
}

// Captures errors thrown in Server Components, Server Actions, and
// API route handlers in app-router land. Sentry's helper enriches the
// event with the request URL, method, and user context automatically.
export const onRequestError = Sentry.captureRequestError
