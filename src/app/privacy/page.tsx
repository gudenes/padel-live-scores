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
      <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 32 }}>Last updated: April 5, 2026</p>

      <p>
        PadelNachos (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) operates the website <strong>padelnachos.com</strong> and
        related services. This Privacy Policy explains how we collect, use, and protect your information when you use our service.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>1. Information We Collect</h2>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 20, marginBottom: 8 }}>Account Information</h3>
      <p>
        When you sign in with Google, we receive your name, email address, and profile picture from Google.
        We store this information to personalize your experience (bookmarks, followed players, preferences).
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 20, marginBottom: 8 }}>Usage Data</h3>
      <p>
        We collect anonymous usage data through Vercel Analytics, including pages visited, device type, and
        general geographic location. This data does not personally identify you and is used to improve our service.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 20, marginBottom: 8 }}>Local Storage</h3>
      <p>
        We use your browser&apos;s local storage to save preferences, bookmarks, and followed items when you
        are not signed in. This data stays on your device and is not transmitted to our servers.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>2. How We Use Your Information</h2>
      <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>To provide and maintain the service</li>
        <li>To personalize your experience (bookmarks, followed players, followed tournaments)</li>
        <li>To send notifications about matches you follow (if you opt in)</li>
        <li>To analyze usage patterns and improve the service</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>3. Data Sharing</h2>
      <p>
        We do not sell, trade, or share your personal information with third parties, except:
      </p>
      <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li><strong>Supabase</strong> — our database provider, which stores account data and preferences</li>
        <li><strong>Vercel</strong> — our hosting provider, which processes web requests and analytics</li>
        <li><strong>Google</strong> — for authentication (OAuth sign-in)</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>4. Data Security</h2>
      <p>
        We use industry-standard security measures including encrypted connections (HTTPS), row-level security
        on our database, and secure authentication flows (PKCE). However, no method of transmission over the
        internet is 100% secure.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>5. Your Rights</h2>
      <p>You have the right to:</p>
      <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>Access the personal data we hold about you</li>
        <li>Request deletion of your account and associated data</li>
        <li>Opt out of analytics tracking</li>
        <li>Export your data</li>
      </ul>
      <p style={{ marginTop: 12 }}>
        To exercise these rights, contact us at the email below.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>6. Cookies</h2>
      <p>
        We use minimal cookies for authentication session management. We do not use advertising cookies
        or third-party tracking cookies.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>7. Children&apos;s Privacy</h2>
      <p>
        Our service is not directed to children under 13. We do not knowingly collect personal information
        from children under 13.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>8. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify users of significant changes
        by posting the new policy on this page with an updated date.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>9. Contact Us</h2>
      <p>
        If you have questions about this Privacy Policy, contact us at: <br />
        <strong style={{ color: '#7ED321' }}>privacy@padelnachos.com</strong>
      </p>
    </div>
  )
}
