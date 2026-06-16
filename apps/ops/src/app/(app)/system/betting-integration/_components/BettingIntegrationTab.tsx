'use client'

// Read-only reference for the betting-odds provider integration. Mirrors the RFI in
// docs/betting/provider-integration-requirements.md so operators have the checklist +
// go-live steps in-app. No data entry — purely a reference page.

import Link from 'next/link'
import { PageHeader, Panel, Section } from '@/components/ui'

type Item = { lead: string; body: string }

const EMBED: Item[] = [
  { lead: 'Embed method', body: 'Iframe URL or JS SDK? We are built for an iframe URL.' },
  { lead: 'URL format + params', body: 'Exact pattern + accepted params: sport (padel), event/market id, locale, geo, theme.' },
  { lead: 'Match identification', body: 'CRITICAL — do they key on their own event ID, or team/player names + date? Names → our template works as-is; their ID → we need a mapping step.' },
  { lead: 'Iframe host domain(s)', body: 'Needed for our CSP frame-src allowlist + iframe sandbox.' },
  { lead: 'Sizing', body: 'Fixed height or auto-resize via postMessage?' },
  { lead: 'Theming', body: 'Dark-mode / brand-color options to match the app.' },
  { lead: 'API key', body: 'Required? Public/browser-safe or server-only?' },
]
const COMMERCIAL: Item[] = [
  { lead: 'Affiliate / partner ID', body: 'Plus the tracking-parameter format — this is what earns the revenue.' },
  { lead: 'Deal terms', body: 'Rev-share vs CPA.' },
  { lead: 'Reporting access', body: 'Dashboard or postback to see clicks/conversions.' },
]
const COMPLIANCE: Item[] = [
  { lead: 'Licensed operators per country', body: 'Tells us which markets to enable.' },
  { lead: 'Mandated disclaimer wording (per country)', body: 'e.g. Spain DGOJ "La ludopatía… +18. Jugarbien.es" — lawyer-approved.' },
  { lead: 'Required logos / links', body: '18+ badge, regulator logo, self-exclusion / helpline URL.' },
  { lead: 'Geo-restriction confirmation', body: 'Written confirmation they auto-restrict to licensed operators.' },
]
const COVERAGE: Item[] = [
  { lead: 'Padel coverage', body: 'Confirm they actually price padel, and which tiers/events (most price only top Premier events).' },
]
const LANDS: Item[] = [
  { lead: 'Embed URL + params', body: 'NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE (Vercel prod env) + BettingProviderWidget.tsx' },
  { lead: 'Iframe host domain', body: 'CSP frame-src allowlist (next.config) + iframe sandbox' },
  { lead: 'Affiliate / partner ID', body: 'Baked into the widget URL template' },
  { lead: 'Licensed-country list', body: 'src/lib/betting-markets.ts (enabled: true per market)' },
  { lead: 'Per-country disclaimer text', body: 'src/messages/*.json → betting.disclaimers.*' },
]
const GOLIVE: string[] = [
  'Set NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE in Vercel prod env.',
  'Allowlist the provider iframe domain in the CSP.',
  'Flip enabled: true for the licensed markets in BETTING_MARKETS.',
  'Paste lawyer-approved disclaimers into betting.disclaimers.*.',
  'Clear the pre-launch compliance checklist (Play Console gambling declaration, store-rating decision, AdMob isolation, gate the ?geo= override to non-prod).',
  'Flip Production ON for betting_enabled in Feature Flags.',
]

function Checklist({ items }: { items: Item[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it) => (
        <li key={it.lead} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5 }}>
          <span aria-hidden style={{ color: 'var(--lime)', flexShrink: 0 }}>▸</span>
          <span style={{ color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--text-1)', fontWeight: 600 }}>{it.lead}</strong> — {it.body}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function BettingIntegrationTab() {
  return (
    <div className="ui-page" style={{ maxWidth: 880 }}>
      <PageHeader
        title="Betting Integration"
        subtitle="What to collect from an odds / affiliate provider before turning the betting feature on. Reference only."
      />

      <Panel>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>
          The betting-odds unit is built and shipping <strong style={{ color: 'var(--text-1)' }}>OFF in production</strong>,
          behind the <Link href="/system/feature-flags" style={{ color: 'var(--lime)' }}>betting_enabled</Link> flag.
          The provider plugs into a single configurable embed; enabling a market is a one-line config change.
          Collect the artifacts below, then follow the go-live sequence and flip the flag on.
        </div>
      </Panel>

      <Section label="Before you start">
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>
          Decide: an <strong style={{ color: 'var(--text-1)' }}>odds aggregator / affiliate network</strong> (one widget,
          multiple sportsbooks — like BeSoccer&apos;s bet365 / Winamax / Sportium row) or a{' '}
          <strong style={{ color: 'var(--text-1)' }}>single sportsbook&apos;s own widget</strong>. The aggregator path is
          what our seam is built for and is preferred.
        </div>
      </Section>

      <Section label="A · Embed (technical)"><Checklist items={EMBED} /></Section>
      <Section label="B · Commercial / affiliate"><Checklist items={COMMERCIAL} /></Section>
      <Section label="C · Compliance / legal (per country)"><Checklist items={COMPLIANCE} /></Section>
      <Section label="D · Coverage"><Checklist items={COVERAGE} /></Section>

      <Section label="Where each artifact lands"><Checklist items={LANDS} /></Section>

      <Section label="Go-live sequence">
        <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {GOLIVE.map((step) => (
            <li key={step} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>{step}</li>
          ))}
        </ol>
      </Section>

      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
        Full RFI to send to providers: <code>docs/betting/provider-integration-requirements.md</code>.
        Design + compliance detail: <code>docs/superpowers/specs/2026-06-15-betting-odds-referral-design.md</code>.
      </div>
    </div>
  )
}
