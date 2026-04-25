'use client'
// src/app/global-error.tsx
//
// Last-resort error boundary in Next.js 16. Catches errors that escape
// every nested error.tsx and the root layout — i.e. errors thrown by
// the root layout itself, or by code that runs before any other
// boundary mounts.
//
// Renders a minimal fallback UI (no styling tokens, no i18n — those
// could themselves be the thing that broke). Reports the error to
// Sentry on mount so we get a record even when the user just reloads
// instead of clicking the retry button.
//
// Per Next.js 16 docs:
//   "global-error.js must define its own <html> and <body> tags,
//   since it is replacing the root layout when active."

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Sentry.captureException is a no-op when SENTRY_DSN is unset, so
    // this stays safe in local dev without bloating dev-tools console.
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body
        style={{
          margin: 0,
          padding: '40px 24px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#1A1A1A',
          color: '#FFF',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', maxWidth: 420, marginBottom: 24 }}>
          The page hit an unexpected error. Our team has been notified — please try again.
        </p>
        <button
          onClick={() => reset()}
          style={{
            background: '#7ED321',
            color: '#0A0A0A',
            border: 'none',
            padding: '10px 24px',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
