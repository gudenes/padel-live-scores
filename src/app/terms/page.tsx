import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'PadelNachos Terms of Service — rules and guidelines for using our platform.',
}

export default function TermsPage() {
  return (
    <div style={{
      maxWidth: 700, margin: '0 auto', padding: '40px 20px 80px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#E2E8F0', background: '#1A1A1A', minHeight: '100vh',
      lineHeight: 1.7, fontSize: 15,
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Terms of Service</h1>
      <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 32 }}>Last updated: April 5, 2026</p>

      <p>
        Welcome to PadelNachos. By accessing or using our website at <strong>padelnachos.com</strong> and
        related services, you agree to be bound by these Terms of Service.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>1. Description of Service</h2>
      <p>
        PadelNachos provides real-time padel match scores, player rankings, tournament information,
        news aggregation, and video highlights. The service is provided free of charge.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>2. User Accounts</h2>
      <p>
        You may use PadelNachos without creating an account. Optional sign-in via Google enables
        additional features such as bookmarks, player following, and personalized content. You are
        responsible for maintaining the security of your account.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>3. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>Use the service for any unlawful purpose</li>
        <li>Attempt to gain unauthorized access to our systems or data</li>
        <li>Scrape, crawl, or automatically extract data from the service without permission</li>
        <li>Interfere with or disrupt the service or servers</li>
        <li>Impersonate another person or entity</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>4. Content and Data</h2>
      <p>
        Match scores, player data, and tournament information are sourced from third-party providers
        and are provided &quot;as is&quot;. We make reasonable efforts to ensure accuracy but do not
        guarantee that all data is complete, current, or error-free.
      </p>
      <p style={{ marginTop: 12 }}>
        News articles and video highlights are aggregated from public sources and remain the property
        of their respective owners. We link to original sources and do not claim ownership of
        third-party content.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>5. Intellectual Property</h2>
      <p>
        The PadelNachos name, logo, and original content (including design, layout, and code) are
        owned by PadelNachos. You may not reproduce, distribute, or create derivative works without
        our written permission.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>6. Disclaimer of Warranties</h2>
      <p>
        The service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any
        kind, either express or implied. We do not warrant that the service will be uninterrupted,
        secure, or error-free.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>7. Limitation of Liability</h2>
      <p>
        To the fullest extent permitted by law, PadelNachos shall not be liable for any indirect,
        incidental, special, or consequential damages arising from your use of or inability to use
        the service.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>8. Account Termination</h2>
      <p>
        We reserve the right to suspend or terminate accounts that violate these terms. You may
        delete your account at any time by contacting us, and we will remove your personal data
        in accordance with our Privacy Policy.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>9. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use of the service after changes
        constitutes acceptance of the updated terms. We will notify users of significant changes
        by posting the new terms on this page.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 32, marginBottom: 12 }}>10. Contact Us</h2>
      <p>
        If you have questions about these Terms of Service, contact us at: <br />
        <strong style={{ color: '#7ED321' }}>hello@padelnachos.com</strong>
      </p>
    </div>
  )
}
