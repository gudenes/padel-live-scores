// src/app/[locale]/(app)/road-to-olympics/email/page.tsx
//
// Two copy-paste email templates: NOC President + Sports Minister. Soft
// Launch ships English-only with a "find your country's contact" hint.
// Hardening Wave adds per-country pre-fill for the top 10 padel countries.

import GlobalHeader from '@/components/nav/GlobalHeader'
import { Link } from '@/i18n/navigation'
import CopyButton from '@/components/road-to-olympics/CopyButton'
import { computeDaysUntil, getState } from '@/lib/road-to-olympics/state'
import {
  buildEmailToNocBody,
  buildEmailToSportsMinisterBody,
} from '@/lib/road-to-olympics/share-copy'

export const dynamic = 'force-dynamic'

export default async function EmailTemplatesPage() {
  const state = getState()
  const daysUntil = computeDaysUntil(state.iocSessionAt)
  const nocBody = buildEmailToNocBody({
    daysUntil,
    federations: state.counters.federationsCount,
  })
  const minBody = buildEmailToSportsMinisterBody({
    daysUntil,
    federations: state.counters.federationsCount,
  })

  return (
    <>
      <GlobalHeader />
      <main style={{
        maxWidth: 600, margin: '0 auto', padding: '20px 16px 40px',
        color: '#fff', minHeight: '100vh', background: '#0a0a0a',
      }}>
        <Link href="/road-to-olympics" style={{ fontSize: 12, color: '#7ed321', textDecoration: 'none' }}>
          ← Road to the Olympics
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '12px 0 8px', lineHeight: 1.2 }}>
          Email your country's sports authorities
        </h1>
        <p style={{ fontSize: 14, color: '#b8b8b8', margin: '0 0 24px', lineHeight: 1.5 }}>
          Two templates below. Copy the one that fits, find the contact for your country
          (search "[country] National Olympic Committee" or "[country] Ministry of Sport"),
          and send. Per-country contacts ship in the next update.
        </p>

        {[
          { title: 'Email your NOC President', body: nocBody },
          { title: 'Email your Sports Minister', body: minBody },
        ].map((tpl) => (
          <section key={tpl.title} style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, padding: 16, marginBottom: 16,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 12, gap: 12,
            }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{tpl.title}</h2>
              <CopyButton text={tpl.body} label="Copy" />
            </div>
            <pre style={{
              background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 6, padding: 12, fontSize: 12, color: '#ddd',
              lineHeight: 1.55, whiteSpace: 'pre-wrap', margin: 0,
              fontFamily: 'ui-monospace, monospace',
            }}>
              {tpl.body}
            </pre>
          </section>
        ))}
      </main>
    </>
  )
}
