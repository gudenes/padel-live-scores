'use client'

import { useEffect, useState, useRef } from 'react'

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
  let bg = 'var(--status-neutral)'
  if (status === 'enriched') bg = 'var(--status-live)'
  else if (status === 'failed') bg = 'var(--status-urgent)'

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 3,
      background: bg, color: '#fff',
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
    }}>
      {status}
      {status === 'failed' && retryCount != null && retryCount > 0 && (
        <span style={{ opacity: 0.85 }}>x{retryCount}</span>
      )}
    </span>
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

  const hasFilters = debouncedSearch || sourceKey || language || enrichmentStatus

  function reset() {
    setSearch('')
    setDebouncedSearch('')
    setSourceKey('')
    setLanguage('')
    setEnrichmentStatus('')
    setPage(0)
  }

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search titles..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '6px 10px', fontSize: 12, border: '1px solid var(--border-subtle)',
            background: 'var(--bg-card)', color: 'var(--brand-primary-fg)',
            minWidth: 200, outline: 'none',
          }}
        />

        <select
          value={sourceKey}
          onChange={e => setSourceKey(e.target.value)}
          style={selectStyle}
        >
          <option value="">All sources</option>
          {facets?.source_keys.map(s => (
            <option key={s.key} value={s.key}>{s.name || s.key}</option>
          ))}
        </select>

        <select
          value={language}
          onChange={e => setLanguage(e.target.value)}
          style={selectStyle}
        >
          <option value="">All languages</option>
          {facets?.languages.map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <select
          value={enrichmentStatus}
          onChange={e => setEnrichmentStatus(e.target.value)}
          style={selectStyle}
        >
          <option value="">All enrichment</option>
          {facets?.enrichment_statuses.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {hasFilters && (
          <button onClick={reset} style={resetBtnStyle}>
            Reset
          </button>
        )}
      </div>

      {/* Pagination summary + controls */}
      {total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, fontSize: 12, color: 'var(--status-neutral)' }}>
          <span>
            Showing {rangeStart}–{rangeEnd} of {total.toLocaleString()}
          </span>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={paginationBtn(page === 0)}
          >
            Prev
          </button>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={paginationBtn(page >= totalPages - 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: 'var(--status-neutral)', padding: 16 }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--status-neutral)', padding: 16 }}>No articles match these filters.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: 'var(--brand-primary-fg)' }}>
          <thead>
            <tr style={{ background: 'var(--bg-canvas)', textAlign: 'left' }}>
              {['Title', 'Source', 'Enriched', 'Published'].map(h => (
                <th key={h} style={{ padding: 8, fontWeight: 700, color: 'var(--status-neutral)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: 8, maxWidth: 480 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener"
                      style={{ color: 'var(--brand-primary-fg)', textDecoration: 'none', fontWeight: 600 }}
                      onMouseOver={e => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseOut={e => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      {r.title}
                    </a>
                    {r.language && (
                      <span style={{
                        fontSize: 10, padding: '1px 5px',
                        background: 'var(--bg-canvas)', color: 'var(--status-neutral)',
                        border: '1px solid var(--border-subtle)', borderRadius: 3,
                        flexShrink: 0,
                      }}>
                        {r.language}
                      </span>
                    )}
                    {r.click_count > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--status-neutral)', flexShrink: 0 }}>
                        {r.click_count} click{r.click_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: 8, whiteSpace: 'nowrap', color: 'var(--status-neutral)' }}>
                  {r.source_name || r.source_key}
                </td>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                  <EnrichmentPill status={r.enrichment_status} />
                </td>
                <td style={{ padding: 8, whiteSpace: 'nowrap', color: 'var(--status-neutral)' }}>
                  {relativeTime(r.published_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '6px 8px', fontSize: 12,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-card)', color: 'var(--brand-primary-fg)',
  outline: 'none', cursor: 'pointer',
}

const resetBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none',
  color: 'var(--status-neutral)', fontSize: 12,
  cursor: 'pointer', textDecoration: 'underline', padding: '6px 4px',
}

function paginationBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'var(--bg-canvas)' : 'var(--brand-primary)',
    color: disabled ? 'var(--status-neutral)' : 'var(--brand-primary-fg)',
    border: disabled ? '1px solid var(--border-subtle)' : 0,
    padding: '6px 14px', fontSize: 12, fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
    clipPath: disabled ? undefined : 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
    opacity: disabled ? 0.5 : 1,
  }
}
