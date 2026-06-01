'use client'

import { useEffect, useState, useRef } from 'react'
import { DataTable, Pill, Button, EmptyState } from '@/components/ui'
import { TranslationChips } from './TranslationChips'
import { ClusterChip } from './ClusterChip'

interface ArticleRow {
  id: string
  title: string
  source_name: string
  source_key: string
  url: string
  language: string | null
  published_at: string
  click_count: number
  enrichment_status: string
  summary_md: string | null
  title_translations: Record<string, string> | null
  summary_translations: Record<string, string> | null
  cluster: { role: 'unique' | 'primary' | 'sibling'; siblingCount: number; primaryId: string | null }
}

interface Facets {
  source_keys: Array<{ key: string; name: string }>
  languages: string[]
  enrichment_statuses: string[]
}

interface ApiResponse {
  articles: ArticleRow[]
  total: number
  page: number
  page_size: number
  facets?: Facets
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso)
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD}d ago`
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function EnrichmentPill({ status, retryCount }: { status: string; retryCount?: number }) {
  const tone = status === 'enriched' ? 'lime' : status === 'failed' ? 'urgent' : 'neutral'

  return (
    <Pill tone={tone}>
      {status}
      {status === 'failed' && retryCount != null && retryCount > 0 && (
        <span style={{ opacity: 0.85, marginLeft: 4 }}>x{retryCount}</span>
      )}
    </Pill>
  )
}

export function ArticlesTable() {
  const [rows, setRows] = useState<ArticleRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [facets, setFacets] = useState<Facets | null>(null)

  const [search, setSearch] = useState('')
  const [sourceKey, setSourceKey] = useState('')
  const [language, setLanguage] = useState('')
  const [enrichmentStatus, setEnrichmentStatus] = useState('')
  const [translationsFilter, setTranslationsFilter] = useState<'all' | 'complete' | 'has-gaps'>('all')
  const [clusterFilter, setClusterFilter] = useState<'all' | 'primary' | 'sibling' | 'unique'>('all')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [sourceKey, language, enrichmentStatus])

  // Fetch on any dependency change
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const params = new URLSearchParams({ page: String(page) })
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (sourceKey) params.set('source_key', sourceKey)
    if (language) params.set('language', language)
    if (enrichmentStatus) params.set('enrichment_status', enrichmentStatus)

    fetch(`/api/articles?${params}`)
      .then(r => r.json() as Promise<ApiResponse>)
      .then(data => {
        if (cancelled) return
        setRows(data.articles ?? [])
        setTotal(data.total ?? 0)
        if (data.facets) setFacets(data.facets)
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [page, debouncedSearch, sourceKey, language, enrichmentStatus])

  const pageSize = 50
  const totalPages = Math.ceil(total / pageSize)
  const rangeStart = page * pageSize + 1
  const rangeEnd = Math.min((page + 1) * pageSize, total)

  const hasFilters = debouncedSearch || sourceKey || language || enrichmentStatus || translationsFilter !== 'all' || clusterFilter !== 'all'

  function reset() {
    setSearch('')
    setDebouncedSearch('')
    setSourceKey('')
    setLanguage('')
    setEnrichmentStatus('')
    setTranslationsFilter('all')
    setClusterFilter('all')
    setPage(0)
  }

  const filteredRows = rows.filter(r => {
    if (clusterFilter !== 'all' && r.cluster?.role !== clusterFilter) return false
    if (translationsFilter === 'complete' || translationsFilter === 'has-gaps') {
      const allFilled = (['es', 'pt', 'it', 'fr'] as const).every(l =>
        r.title_translations?.[l] && r.summary_translations?.[l]
      )
      if (translationsFilter === 'complete' && !allFilled) return false
      if (translationsFilter === 'has-gaps' && allFilled) return false
    }
    return true
  })

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search titles..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="ui-input"
          style={{ minWidth: 200 }}
        />

        <select
          value={sourceKey}
          onChange={e => setSourceKey(e.target.value)}
          className="ui-select"
        >
          <option value="">All sources</option>
          {facets?.source_keys.map(s => (
            <option key={s.key} value={s.key}>{s.name || s.key}</option>
          ))}
        </select>

        <select
          value={language}
          onChange={e => setLanguage(e.target.value)}
          className="ui-select"
        >
          <option value="">All languages</option>
          {facets?.languages.map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <select
          value={enrichmentStatus}
          onChange={e => setEnrichmentStatus(e.target.value)}
          className="ui-select"
        >
          <option value="">All enrichment</option>
          {facets?.enrichment_statuses.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select value={translationsFilter} onChange={e => setTranslationsFilter(e.target.value as never)} className="ui-select">
          <option value="all">Translations: All</option>
          <option value="complete">Complete</option>
          <option value="has-gaps">Has gaps</option>
        </select>

        <select value={clusterFilter} onChange={e => setClusterFilter(e.target.value as never)} className="ui-select">
          <option value="all">Cluster: All</option>
          <option value="primary">Primary</option>
          <option value="sibling">Sibling</option>
          <option value="unique">Unique</option>
        </select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset
          </Button>
        )}
      </div>

      {/* Pagination summary + controls */}
      {total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, fontSize: 12, color: 'var(--text-3)' }}>
          <span>
            Showing {rangeStart}–{rangeEnd} of {total.toLocaleString()}
          </span>
          <Button
            size="sm"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Prev
          </Button>
          <Button
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </Button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: 'var(--text-3)', padding: 16 }}>Loading...</div>
      ) : filteredRows.length === 0 ? (
        <EmptyState title="No articles match these filters." />
      ) : (
        <DataTable>
          <thead>
            <tr>
              {['Title', 'Source', 'Enriched', 'Translations', 'Cluster', 'Published'].map(h => (
                <th key={h} style={{ whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(r => (
              <tr key={r.id} data-article-id={r.id}>
                <td style={{ maxWidth: 480 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener"
                      style={{ color: 'var(--text-1)', textDecoration: 'none', fontWeight: 600 }}
                      onMouseOver={e => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseOut={e => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      {r.title}
                    </a>
                    {r.language && (
                      <span style={{
                        fontSize: 10, padding: '1px 5px',
                        background: 'var(--bg-card-2)', color: 'var(--text-3)',
                        border: '1px solid var(--border-card)', borderRadius: 'var(--r-xs)',
                        flexShrink: 0,
                      }}>
                        {r.language}
                      </span>
                    )}
                    {r.click_count > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
                        {r.click_count} click{r.click_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
                  {r.source_name || r.source_key}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <EnrichmentPill status={r.enrichment_status} />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <TranslationChips
                    title_translations={r.title_translations}
                    summary_translations={r.summary_translations}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <ClusterChip
                    role={r.cluster?.role ?? 'unique'}
                    siblingCount={r.cluster?.siblingCount}
                    primaryId={r.cluster?.primaryId}
                    onSiblingClick={pid => {
                      const el = document.querySelector(`[data-article-id="${pid}"]`)
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
                  {relativeTime(r.published_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  )
}
