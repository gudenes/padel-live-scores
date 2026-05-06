// Idempotent analytics SDK init. Safe to call from:
// - instrumentation-client.ts at boot (cold start)
// - ConsentBanner Save handler (warm — user just opted in)
//
// Both PostHog and Sentry are no-op-on-already-initialised, so calling
// this twice is harmless.

import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'
import { parseConsent, migrateLegacy } from './consent'

function readAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem('pn_consent')
    const legacy = localStorage.getItem('pn_analytics_opt_out')
    const parsed = parseConsent(raw)
    if (parsed) return parsed.analytics === true
    const migrated = migrateLegacy(raw, legacy)
    if (migrated) return migrated.analytics === true
  } catch { /* localStorage blocked → no consent */ }
  return false
}

let posthogInitialised = false
let sentryInitialised = false

function initSentry() {
  if (sentryInitialised) return
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
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
  sentryInitialised = true
}

function initPostHog() {
  if (posthogInitialised) return
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return
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
  posthogInitialised = true
}

/** Initialise PostHog + Sentry browser SDKs iff the user has consented. */
export function initAnalyticsIfAllowed(): void {
  if (!readAnalyticsConsent()) return
  initSentry()
  initPostHog()
}
