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
import posthog from 'posthog-js'

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
      // Instagram Android in-app browser injects its own
      // `navigation_performance_logger_android` script and tears down
      // the Java bridge before the JS callback fires. Throws on every
      // navigate-away and is unfixable from our side.
      /Java object is gone/,
      /enableDidUserTypeOnKeyboardLogging/,
    ],
    // Drop events whose top frame originates from the Instagram
    // in-app browser's injected scripts — same noise as above, but
    // catches variants that don't match the message regex.
    denyUrls: [
      /^app:\/\/navigation_performance_logger_android/,
    ],
  })
}

// Surfaced regardless of whether Sentry is enabled — the SDK function
// is a safe no-op when init() didn't fire. Wiring this up means
// client-side route changes get clean transaction boundaries.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

// ── PostHog ────────────────────────────────────────────────────────
//
// Product analytics + session replay + feature flags. EU cloud (Frankfurt)
// for GDPR. Same gating story as Sentry: env-var presence is the on/off
// switch so PR previews and local dev stay quiet by default.
//
// User-side opt-out: the existing `pn_analytics_opt_out` localStorage flag
// (toggled in /profile/settings) suppresses init entirely. We don't load
// the SDK at all when opted out — no events, no replay, no fingerprinting,
// no cookies dropped.
//
// Routing requests through /ingest/* (rewrite in next.config.ts) makes
// PostHog look like first-party traffic. Without that, ad-blockers
// shadow-drop posthog.com and ~30% of users vanish from analytics.
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  let optedOut = false
  try {
    optedOut = localStorage.getItem('pn_analytics_opt_out') === '1'
  } catch { /* localStorage blocked → treat as not-opted-out */ }

  if (!optedOut) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: '/ingest',
      ui_host: 'https://eu.posthog.com',
      // Treat the SDK's "person profile" creation as opt-in by default.
      // We promote anonymous → identified inside <PostHogIdentify> when
      // the user logs in. Avoids creating profiles for bots / drive-bys.
      person_profiles: 'identified_only',
      // Capture pageviews automatically (Next.js client routing fires a
      // popstate that PostHog hooks into). We also capture clicks +
      // form submits — `autocapture: true` is the default but we set
      // it explicitly so behavior is locked even if defaults change.
      autocapture: true,
      capture_pageview: true,
      capture_pageleave: true,
      // Session replay — masks every input by default (so passwords,
      // emails, search queries never leave the browser). Text content
      // is captured so we can see what the user saw. Switch any
      // sensitive node to `data-private="true"` to opt it out further.
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '[data-private="true"]',
      },
      // Disable PostHog's surveys feature for now — we don't use it
      // and it ships extra JS we'd rather not download.
      disable_surveys: true,
      // Defer initialization until the page has settled so we don't
      // contend with first-paint resources.
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') {
          ph.debug(false)  // flip to true if you need to inspect events
        }
      },
    })
  }
}
