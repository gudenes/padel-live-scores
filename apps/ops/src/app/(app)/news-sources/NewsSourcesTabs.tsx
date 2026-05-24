'use client'

import { useState } from 'react'
import Link from 'next/link'
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
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: 'var(--brand-primary-fg)' }}>News Sources</h1>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <TabLink active={activeTab === 'sources'}     href="?tab=sources">Sources</TabLink>
        <TabLink active={activeTab === 'suggestions'} href="?tab=suggestions">Suggestions</TabLink>
        <TabLink active={activeTab === 'articles'}    href="?tab=articles">Articles</TabLink>
        <TabLink active={activeTab === 'health'}      href="?tab=health">Discovery Health</TabLink>
      </nav>
      {activeTab === 'sources' && (
        <>
          <div style={{ padding: '12px 8px', display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowAddDrawer(true)}
              style={{ background: 'var(--brand-primary)', color: 'var(--brand-primary-fg)', border: 0, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }}
            >
              + Add Source
            </button>
            <button
              onClick={() => setShowDiscover(true)}
              style={{ background: 'var(--bg-canvas)', color: 'var(--brand-primary-fg)', border: '1px solid var(--border-subtle)', padding: '8px 16px', fontWeight: 700, cursor: 'pointer' }}
            >
              Discover with AI
            </button>
          </div>
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
      background: active ? 'var(--brand-primary)' : 'var(--bg-canvas)',
      color: active ? 'var(--brand-primary-fg)' : 'var(--status-neutral)',
      fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
      textDecoration: 'none',
      clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
    }}>
      {children}
    </Link>
  )
}
