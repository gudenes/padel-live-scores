import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'PadelNachos Privacy Policy — how we collect, use, and protect your data.',
}

export default function PrivacyPage() {
  return (
    <div style={{
      maxWidth: 700, margin: '0 auto', padding: '40px 20px 80px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#E2E8F0', background: '#1A1A1A', minHeight: '100vh',
      lineHeight: 1.7, fontSize: 15,
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 32 }}>Last updated: May 3, 2026</p>

      <p>
        PadelNachos (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) operates the website <strong>padelnachos.com</strong>,
        the Padel Nachos mobile applications (Android and iOS), and related services. This Privacy Policy explains
        how we collect, use, and protect your information when you use our service.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>1. Information We Collect</h2>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 20, marginBottom: 8 }}>Account Information</h3>
      <p>
        When you sign in with Google or via magic link email, we receive your name, email address, and profile
        picture (Google sign-in only). We store this information to personalize your experience (bookmarks,
        followed players, predictions, preferences).
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 20, marginBottom: 8 }}>Push Notification Tokens</h3>
      <p>
        If you opt in to push notifications, we collect and store a device-specific notification token: a Firebase
        Cloud Messaging (FCM) token on Android, an Apple Push Notification service (APNs) token on iOS, or a Web
        Push subscription on browsers. These tokens are pseudonymous device identifiers used solely to deliver the
        match notifications you subscribed to. You can revoke them at any time from your operating system settings
        or by signing out.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 20, marginBottom: 8 }}>Usage and Performance Data</h3>
      <p>
        We collect anonymous usage data through Vercel Analytics and PostHog, including pages visited, device type,
        general geographic location (country level), and interactions with key features. We use Sentry to capture
        application error reports, which may include diagnostic context such as a user identifier when you are
        signed in. This data is used to improve the service and fix bugs; it is not sold or shared for advertising.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 20, marginBottom: 8 }}>Local Storage</h3>
      <p>
        We use your browser&apos;s local storage to save preferences, bookmarks, predictions, and followed items
        when you are not signed in. This data stays on your device and is not transmitted to our servers unless
        you sign in.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>2. How We Use Your Information</h2>
      <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>To provide and maintain the service</li>
        <li>To personalize your experience (bookmarks, followed players, followed tournaments, predictions)</li>
        <li>To send notifications about matches and tournaments you follow (only if you opt in)</li>
        <li>To send transactional emails such as the magic-link sign-in code and welcome message</li>
        <li>To analyze usage patterns, fix bugs, and improve the service</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>3. Data Sharing</h2>
      <p>
        We do not sell, trade, or rent your personal information. We share data only with the third-party service
        providers required to operate the app, listed below:
      </p>
      <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li><strong>Supabase</strong> — database and authentication backend; stores account data, preferences, and push tokens</li>
        <li><strong>Vercel</strong> — hosting provider; processes web requests and provides usage analytics</li>
        <li><strong>Google</strong> — OAuth sign-in (when you choose &quot;Sign in with Google&quot;) and Firebase Cloud Messaging (Android push delivery)</li>
        <li><strong>Apple</strong> — Apple Push Notification service (iOS push delivery, when applicable)</li>
        <li><strong>Resend</strong> — transactional email delivery (magic-link sign-in codes, welcome emails)</li>
        <li><strong>PostHog</strong> — product analytics (page views, feature interactions); anonymized at the device level unless you are signed in</li>
        <li><strong>Sentry</strong> — application error and crash reporting</li>
      </ul>
      <p style={{ marginTop: 12 }}>
        Each of these providers processes data on our behalf under their own privacy commitments. We do not share
        data with advertisers, data brokers, or unrelated third parties.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>4. Data Security</h2>
      <p>
        We use industry-standard security measures including encrypted connections (HTTPS), row-level security
        on our database, and secure authentication flows (PKCE for OAuth, signed magic-link tokens for email).
        However, no method of transmission over the internet is 100% secure.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>5. Your Rights</h2>
      <p>You have the right to:</p>
      <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>Access the personal data we hold about you</li>
        <li>Request deletion of your account and associated data (see Section 6)</li>
        <li>Opt out of analytics tracking</li>
        <li>Export your data</li>
        <li>Withdraw consent for push notifications at any time</li>
      </ul>
      <p style={{ marginTop: 12 }}>
        If you are in the European Economic Area, the United Kingdom, or California, you have additional rights
        under the GDPR, UK GDPR, and CCPA respectively, including the right to lodge a complaint with your local
        data protection authority. To exercise any of these rights, contact us at the email below.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>6. Account Deletion</h2>
      <p>
        You can request deletion of your account and all associated personal data at any time by emailing
        {' '}<strong style={{ color: '#7ED321' }}>hello@padelnachos.com</strong> from the email address tied to your
        account, with the subject &quot;Delete my account&quot;. We will confirm the request and complete the
        deletion within 30 days. Deletion removes your profile, preferences, bookmarks, predictions, and push
        notification tokens. Anonymized analytics events that cannot be linked back to you may be retained.
      </p>
      <p style={{ marginTop: 12 }}>
        We are also adding an in-app &quot;Delete account&quot; option that will let you complete the request
        without contacting support; until that ships, the email path above is the supported method.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>7. Cookies and Local Storage</h2>
      <p>
        We use minimal cookies for authentication session management and locale preference. We use the browser&apos;s
        local storage and the mobile app&apos;s local storage for offline-friendly features (bookmarks, predictions,
        UI preferences). We do not use advertising cookies or third-party tracking cookies.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>8. Children&apos;s Privacy</h2>
      <p>
        Our service is not directed to children under 13. We do not knowingly collect personal information
        from children under 13. If you believe a child has provided us with personal information, contact us
        and we will delete it.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>9. Data Retention</h2>
      <p>
        We retain account data for as long as your account is active. If you delete your account, personal data
        is removed within 30 days. Anonymous usage analytics may be retained indefinitely in aggregated form.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>10. International Data Transfers</h2>
      <p>
        Our service providers may store and process data in the United States, the European Union, and other
        countries where they operate. By using the service, you acknowledge that your data may be transferred
        across borders subject to the safeguards required by applicable law.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>11. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify users of significant changes
        by posting the new policy on this page with an updated date. For changes that materially affect your
        rights, we will provide additional notice (e.g., in-app banner or email).
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>12. Contact Us</h2>
      <p>
        If you have questions about this Privacy Policy or your data, contact us at: <br />
        <strong style={{ color: '#7ED321' }}>hello@padelnachos.com</strong>
      </p>
    </div>
  )
}
