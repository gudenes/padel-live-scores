// Idempotent analytics SDK init. Safe to call from:
// - instrumentation-client.ts at boot (cold start)
// - ConsentBanner Save handler (warm — user just opted in)
//
// Both PostHog and Sentry are no-op-on-already-initialised, so calling
// this twice is harmless.

import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'
import { Capacitor } from '@capacitor/core'
import { parseConsent, migrateLegacy } from './consent'

// True when running inside a Capacitor native shell (iOS or Android),
// false in the web/PWA WebView. We change PostHog's persistence model
// on native to comply with App Review Guideline 5.1.2(i): no tracking
// cookies, no localStorage identifiers, no session replay. Events still
// fire, but each session is anonymous and ephemeral — no cross-session
// dedup, no cohort retention. Web/PWA users retain the full flow.
function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false
  try { return Capacitor.isNativePlatform() } catch { return false }
}

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
    // This runs in the BROWSER, where Next.js only inlines NEXT_PUBLIC_*
    // (plus NODE_ENV) at build time. The old chain ended in
    // RAILWAY_ENVIRONMENT_NAME / RAILWAY_GIT_COMMIT_SHA, which are
    // server-only — so post-Railway every production client error was
    // tagged `environment: development` with no release, and uploaded
    // source maps never matched. Read the NEXT_PUBLIC_* vars (set them on
    // Railway at build time), keep the Vercel ones as fallbacks, and fall
    // back to the build mode rather than a hardcoded 'development'.
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT
      ?? process.env.NEXT_PUBLIC_VERCEL_ENV
      ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
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
  const native = isCapacitorNative()
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: '/ingest',
    ui_host: 'https://eu.posthog.com',
    // Treat the SDK's "person profile" creation as opt-in by default.
    // We promote anonymous → identified inside <PostHogIdentify> when
    // the user logs in. Avoids creating profiles for bots / drive-bys.
    person_profiles: 'identified_only',
    // On Capacitor native shells we run in "memory" mode — identity
    // lives in RAM and dies with the WebView. No cookies, no
    // localStorage, no IndexedDB persisted by PostHog. This is the
    // App Review Guideline 5.1.2(i) compliance lever: Apple's reviewer
    // flagged tracking cookies in the iOS WebView, so we make sure
    // PostHog drops none on native. Web/PWA keeps the default
    // localStorage flow for cross-session continuity.
    persistence: native ? 'memory' : 'localStorage+cookie',
    // Pageview + page-leave still fire on native — those are what we
    // care about for "what screens are people using" — but we disable
    // autocapture (which scrapes every click/submit and produces
    // richer cross-session data) and session recording (which is
    // unambiguously "tracking" in Apple's lens).
    autocapture: !native,
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: native,
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

/** Initialise PostHog + Sentry browser SDKs iff the user has consented
 * (web/PWA) or we're on a Capacitor native shell (no consent banner is
 * shown on native; PostHog runs in memory mode there — see initPostHog).
 * Sentry is always safe to enable: it does not set tracking cookies and
 * its error/perf payloads stay between the device and our project. */
export function initAnalyticsIfAllowed(): void {
  if (!readAnalyticsConsent() && !isCapacitorNative()) return
  initSentry()
  initPostHog()
}
