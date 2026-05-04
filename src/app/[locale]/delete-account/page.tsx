import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Delete your account',
  description:
    'How to permanently delete your Padel Nachos account and the data associated with it.',
}

export default function DeleteAccountPage() {
  return (
    <div
      style={{
        maxWidth: 700,
        margin: '0 auto',
        padding: '40px 20px 80px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#E2E8F0',
        background: '#1A1A1A',
        minHeight: '100vh',
        lineHeight: 1.7,
        fontSize: 15,
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
        Delete your Padel Nachos account
      </h1>
      <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 32 }}>
        Last updated: May 4, 2026
      </p>

      <p>
        This page explains how to permanently delete your account on{' '}
        <strong>Padel Nachos</strong> (padelnachos.com — the &quot;Padel Nachos: Live
        Scores&quot; app on Google Play and the iOS App Store, operated by PadelNachos).
        We offer two ways to request deletion: directly from inside the app, or via
        email if you have already uninstalled the app.
      </p>

      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#fff',
          marginTop: 32,
          marginBottom: 12,
        }}
      >
        Option 1 — Delete from inside the app (recommended)
      </h2>
      <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>Open the Padel Nachos app on your phone.</li>
        <li>
          Tap the <strong>Profile</strong> tab in the bottom navigation, then tap{' '}
          <strong>Settings</strong> (the gear icon, top-right).
        </li>
        <li>
          Scroll down to the <strong>Privacy &amp; Data</strong> section.
        </li>
        <li>
          Tap <strong>Delete my account</strong> (red).
        </li>
        <li>
          Confirm the action by typing <code>DELETE</code> in the confirmation box and
          tapping the red <strong>Delete account</strong> button.
        </li>
      </ol>
      <p style={{ marginTop: 12 }}>
        Deletion runs immediately and is irreversible. You will be signed out and
        returned to the home screen.
      </p>

      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#fff',
          marginTop: 32,
          marginBottom: 12,
        }}
      >
        Option 2 — Delete by email
      </h2>
      <p>
        If you have uninstalled the app or otherwise cannot access the in-app option,
        send an email to{' '}
        <strong style={{ color: '#7ED321' }}>hello@padelnachos.com</strong> from the
        email address tied to your account, with the subject line:
      </p>
      <pre
        style={{
          background: '#0A0A0A',
          color: '#7ED321',
          padding: '12px 14px',
          borderRadius: 8,
          marginTop: 12,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", monospace',
          fontSize: 14,
          overflowX: 'auto',
        }}
      >
        Delete my account
      </pre>
      <p style={{ marginTop: 12 }}>
        We will confirm the request and complete the deletion within{' '}
        <strong>30 days</strong>. You may be asked to reply from the same email address
        if we cannot match your request to an account.
      </p>

      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#fff',
          marginTop: 32,
          marginBottom: 12,
        }}
      >
        What gets deleted
      </h2>
      <p>
        When your account is deleted, the following personal data is permanently
        removed from our database:
      </p>
      <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>Your profile (display name, email, profile picture, locale, language)</li>
        <li>Your bookmarks (bookmarked players, tournaments, and matches)</li>
        <li>Your follows (followed players and tournaments)</li>
        <li>Your match predictions</li>
        <li>Your in-app notification history</li>
        <li>Push notification tokens for all your devices (Android, iOS, web)</li>
        <li>Your sign-in sessions and OAuth links (Google sign-in, magic-link records)</li>
        <li>Your match ratings and earned badges</li>
        <li>Your activity log entries</li>
        <li>Any racket / equipment click history</li>
      </ul>

      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#fff',
          marginTop: 32,
          marginBottom: 12,
        }}
      >
        What is kept
      </h2>
      <p>The following may be retained after deletion:</p>
      <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>
          <strong>Anonymized analytics events</strong> — aggregated usage data (page
          views, feature interactions) that has already been stripped of any link back
          to your account is kept indefinitely for product analytics. It cannot be
          re-associated with you.
        </li>
        <li>
          <strong>Crash and error reports</strong> — Sentry may retain crash logs
          attached to your former user identifier for up to 90 days for stability
          analysis, after which they are purged.
        </li>
        <li>
          <strong>Email-delivery records</strong> — Resend (our transactional email
          provider) retains delivery logs for up to 30 days for operational
          troubleshooting (bounces, deliverability), then deletes them.
        </li>
        <li>
          <strong>Backup snapshots</strong> — automatic database backups taken before
          your deletion may contain your data for up to 7 days, after which they
          expire and are overwritten.
        </li>
      </ul>
      <p style={{ marginTop: 12 }}>
        We do not sell or share personal data with advertisers or data brokers, and we
        never have. See our{' '}
        <a href="/privacy" style={{ color: '#7ED321', textDecoration: 'underline' }}>
          Privacy Policy
        </a>{' '}
        for the full list of processors.
      </p>

      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#fff',
          marginTop: 32,
          marginBottom: 12,
        }}
      >
        Retention period
      </h2>
      <p>
        Personal data tied to your account is removed within <strong>30 days</strong>{' '}
        of a confirmed deletion request. The retained categories listed above expire
        on their own schedules (90 days for Sentry, 30 days for Resend, 7 days for
        backups).
      </p>

      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#fff',
          marginTop: 32,
          marginBottom: 12,
        }}
      >
        Questions
      </h2>
      <p>
        If you have any questions about deletion or your data, contact us at{' '}
        <strong style={{ color: '#7ED321' }}>hello@padelnachos.com</strong>. You can
        also review our full{' '}
        <a href="/privacy" style={{ color: '#7ED321', textDecoration: 'underline' }}>
          Privacy Policy
        </a>
        .
      </p>
    </div>
  )
}
