'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PageHeader, Button } from '@/components/ui'
import { SourcesTable } from './SourcesTable'
import { SuggestionsTable } from './SuggestionsTable'
import { DiscoveryHealth } from './DiscoveryHealth'
import { ArticlesTable } from './ArticlesTable'
import { AddSourceDrawer } from './AddSourceDrawer'
import { DiscoverWithAIModal } from './DiscoverWithAIModal'

type Tab = 'sources' | 'suggestions' | 'articles' | 'health'

export function NewsSourcesTabs({ activeTab }: { activeTab: Tab }) {
  const [showAddDrawer, setShowAddDrawer] = useState(false)
  const [showDiscover, setShowDiscover] = useState(false)

  return (
    <div className="ui-page">
      <PageHeader
        title="News Sources"
        actions={activeTab === 'sources' ? (
          <>
            <Button variant="primary" onClick={() => setShowAddDrawer(true)}>+ Add Source</Button>
            <Button onClick={() => setShowDiscover(true)}>Discover with AI</Button>
          </>
        ) : undefined}
      />
      <nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <TabLink active={activeTab === 'sources'}     href="?tab=sources">Sources</TabLink>
        <TabLink active={activeTab === 'suggestions'} href="?tab=suggestions">Suggestions</TabLink>
        <TabLink active={activeTab === 'articles'}    href="?tab=articles">Articles</TabLink>
        <TabLink active={activeTab === 'health'}      href="?tab=health">Discovery Health</TabLink>
      </nav>
      {activeTab === 'sources' && (
        <>
          <SourcesTable />
          {showAddDrawer && (
            <AddSourceDrawer
              onClose={() => setShowAddDrawer(false)}
              onSaved={() => { setShowAddDrawer(false); window.location.reload() }}
            />
          )}
          {showDiscover && (
            <DiscoverWithAIModal
              onClose={() => setShowDiscover(false)}
              onDone={() => { /* could switch to suggestions tab — for now just close */ }}
            />
          )}
        </>
      )}
      {activeTab === 'suggestions' && <SuggestionsTable />}
      {activeTab === 'articles'    && <ArticlesTable />}
      {activeTab === 'health'      && <DiscoveryHealth />}
    </div>
  )
}

function TabLink({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: '8px 14px',
      borderRadius: 'var(--r-sm)',
      background: active ? 'var(--lime-bg)' : 'transparent',
      color: active ? 'var(--lime-text)' : 'var(--text-3)',
      border: active ? '1px solid var(--lime-border)' : '1px solid transparent',
      fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
      textDecoration: 'none',
    }}>
      {children}
    </Link>
  )
}
