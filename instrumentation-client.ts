// instrumentation-client.ts
//
// Next.js 16 client-side instrumentation entry point. Body code runs
// once on init, before the app becomes interactive. We use it to
// bootstrap Sentry's browser SDK (error capture, performance traces,
// router-transition timings).
//
// `onRouterTransitionStart` is the official Next.js 16 hook for
// notifying the SDK when client-side navigations begin. Sentry uses
// it to start a transaction so navigation perf is captured cleanly.

import * as Sentry from '@sentry/nextjs'

// Init only when the DSN is set — otherwise this file is a no-op so we
// can ship the code to all environments (local dev, PR previews, prod)
// without paying for events we don't want.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT
      ?? process.env.NEXT_PUBLIC_VERCEL_ENV
      ?? 'development',
    release:
      process.env.NEXT_PUBLIC_SENTRY_RELEASE
      ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
      ?? undefined,
    sendDefaultPii: false,
    // 10% perf sampling on the client, same as server. Errors are
    // always at 100% (Sentry doesn't sample errors).
    tracesSampleRate: 0.1,
    // Session replay is intentionally OFF here. Replay would require
    // a separate consent banner under GDPR (record-and-store before
    // user opts in is risky territory). Revisit when the consent
    // infra lands — see future Clarity / consent PR.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Filter the same Next.js control-flow throws + browser-extension
    // noise that flood every Sentry project on day one.
    ignoreErrors: [
      'NEXT_REDIRECT',
      'NEXT_NOT_FOUND',
      'ResizeObserver loop',
      // Common browser-extension content-script errors that the
      // application code can't fix
      "Can't find variable: ZiloCS",
      // Service worker / cache-related noise we generally can't act on
      'Failed to fetch dynamically imported module',
    ],
  })
}

// Surfaced regardless of whether Sentry is enabled — the SDK function
// is a safe no-op when init() didn't fire. Wiring this up means
// client-side route changes get clean transaction boundaries.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
