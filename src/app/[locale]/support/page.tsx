import type { Metadata } from 'next'

// Support page — referenced as the App Store Support URL during
// submission. Apple's reviewer checks this URL during review and
// rejects apps that point Support URL at a Terms of Service or
// About page. Contract: this page must offer a clear way to get
// help (email + FAQ at minimum).
//
// English-only content for now. Lives under /[locale]/support so
// every locale gets the same page at the right path — App Store
// listings only require the URL to resolve in any one language.

export const metadata: Metadata = {
  title: 'Support — Padel Nachos',
  description:
    'Get help with Padel Nachos — live padel scores, rankings, and tournament tracking. Contact us at hello@padelnachos.com.',
}

export default function SupportPage() {
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
        Support
      </h1>
      <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 32 }}>
        Padel Nachos — Help, FAQs, and contact
      </p>

      <p>
        Padel Nachos is built and maintained by an independent team of padel
        fans. If something is broken, confusing, or missing — we want to hear
        about it. The fastest way to reach us is by email:
      </p>

      <p
        style={{
          padding: '20px',
          background: '#0F1A0F',
          border: '1px solid rgba(126, 211, 33, 0.25)',
          borderRadius: 8,
          margin: '24px 0',
          textAlign: 'center',
        }}
      >
        <strong style={{ color: '#7ED321', fontSize: 18 }}>
          hello@padelnachos.com
        </strong>
        <br />
        <span style={{ color: '#6B7280', fontSize: 13 }}>
          We respond within 1–2 business days.
        </span>
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>
        Frequently asked questions
      </h2>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 24, marginBottom: 8 }}>
        How do I create an account?
      </h3>
      <p>
        Padel Nachos works without an account — you can browse live scores,
        rankings, and tournaments anonymously. To follow specific players or
        bookmark matches and receive push notifications, sign in with Google,
        Apple, or a one-time email magic-link from the Profile tab.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 24, marginBottom: 8 }}>
        I&apos;m not receiving push notifications. What should I do?
      </h3>
      <p>
        First, make sure notifications are enabled at the system level
        (Settings → Padel Nachos → Notifications → Allow Notifications). Then,
        inside the app, go to Profile → Settings → Notifications and confirm
        the master toggle is on, plus the specific categories you want
        (Matches, Achievements). If you still don&apos;t receive alerts, try
        toggling the master push switch off and back on to re-register your
        device — and email us if that doesn&apos;t resolve it.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 24, marginBottom: 8 }}>
        How do I follow a player or bookmark a match?
      </h3>
      <p>
        Tap any player&apos;s name to open their profile, then tap the heart
        icon to follow. For matches, tap the star icon on a match card to
        bookmark it. Push notifications for that player or match will start
        arriving immediately if you have notifications enabled.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 24, marginBottom: 8 }}>
        Why is a score, ranking, or tournament showing incorrectly?
      </h3>
      <p>
        Live scores and rankings come from the official Premier Padel and FIP
        data feeds, but we cache values for performance and occasional gaps
        can occur during fast-paced tournaments. If you spot a clearly wrong
        number, screenshot it and email us — we&apos;ll investigate and patch
        the source within a few hours during business days.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 24, marginBottom: 8 }}>
        Can I delete my account?
      </h3>
      <p>
        Yes. Email us at <strong style={{ color: '#7ED321' }}>hello@padelnachos.com</strong>{' '}
        from the address tied to your account, asking for deletion. We&apos;ll
        confirm and remove your data (account record, follows, bookmarks,
        push subscriptions) within 30 days, in line with GDPR / CCPA
        requirements. Anonymous usage analytics may be retained in
        aggregated form.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 24, marginBottom: 8 }}>
        Is the app really free?
      </h3>
      <p>
        Yes — Padel Nachos is free to use. No paywalls, no subscriptions, no
        premium tier.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginTop: 24, marginBottom: 8 }}>
        Where does the data come from?
      </h3>
      <p>
        Live scores, draws, and player profiles come from the public Premier
        Padel and FIP (International Padel Federation) data feeds. We are an
        independent project — not affiliated with Premier Padel or the FIP —
        and we credit those sources accordingly.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 40, marginBottom: 12 }}>
        Privacy and Terms
      </h2>
      <p>
        For information on how we handle your data, see our{' '}
        <a href="/privacy" style={{ color: '#7ED321' }}>Privacy Policy</a>. The
        full Terms of Service are at{' '}
        <a href="/terms" style={{ color: '#7ED321' }}>Terms of Service</a>.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>
        Still stuck?
      </h2>
      <p>
        Email <strong style={{ color: '#7ED321' }}>hello@padelnachos.com</strong>{' '}
        with as much detail as possible — your device model, app version (find
        it under Profile → About), and steps to reproduce. Attaching a
        screenshot speeds things up a lot.
      </p>
    </div>
  )
}
