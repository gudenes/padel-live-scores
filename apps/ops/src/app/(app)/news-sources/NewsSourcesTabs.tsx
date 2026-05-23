'use client'

import Link from 'next/link'
import { SourcesTable } from './SourcesTable'
import { SuggestionsTable } from './SuggestionsTable'
import { DiscoveryHealth } from './DiscoveryHealth'

type Tab = 'sources' | 'suggestions' | 'health'

export function NewsSourcesTabs({ activeTab }: { activeTab: Tab }) {
  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: '#fff' }}>News Sources</h1>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <TabLink active={activeTab === 'sources'}     href="?tab=sources">Sources</TabLink>
        <TabLink active={activeTab === 'suggestions'} href="?tab=suggestions">Suggestions</TabLink>
        <TabLink active={activeTab === 'health'}      href="?tab=health">Discovery Health</TabLink>
      </nav>
      {activeTab === 'sources'     && <SourcesTable />}
      {activeTab === 'suggestions' && <SuggestionsTable />}
      {activeTab === 'health'      && <DiscoveryHealth />}
    </div>
  )
}

function TabLink({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: '8px 14px',
      background: active ? '#7ED321' : '#1A1A1A',
      color: active ? '#0a0a0a' : '#6B7280',
      fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
      textDecoration: 'none',
      clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
    }}>
      {children}
    </Link>
  )
}
