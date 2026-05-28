import { PartnersClient } from './PartnersClient'

export const metadata = { title: 'Partners · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function PartnersPage() {
  return (
    <div style={{ padding: 32, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Partners</h1>
      <p style={{ fontSize: 13, color: 'var(--status-neutral)', margin: '0 0 24px' }}>
        Country-keyed ecommerce partners. Click &quot;manage&quot; on a row to set per-racket URL overrides.
      </p>
      <PartnersClient />
    </div>
  )
}
