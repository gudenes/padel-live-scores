'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, Button } from '@/components/ui'
import { REGION_NAMES, countriesForRegion, regionForCountry, type RegionName } from '@/lib/where-to-watch/regions'

interface ChannelOpt { id: string; name: string; abbreviation: string }
interface Rule { id: string; country_iso2: string; source: string; note: string | null }
interface Suggestion { country: string; reasons: string[]; ytBlockedCount?: number; ytSampleSize?: number }
interface Payload { rules: Rule[]; watchOn: Record<string, string[]>; suggestions: Suggestion[]; observedAt: string | null }

const SOURCE_LABEL: Record<string, string> = {
  seed: 'Preset', yt_api: 'Detected on YouTube', broadcaster: 'From broadcaster list', manual: 'Added manually',
}

function reasonText(s: Suggestion): string {
  const bits: string[] = []
  if (s.reasons.includes('yt_api') && s.ytSampleSize) {
    bits.push(`YouTube blocked this channel in ${s.ytBlockedCount} of the last ${s.ytSampleSize} recorded matches`)
  }
  if (s.reasons.includes('broadcaster')) bits.push('has a local broadcaster but the stream isn\'t blocked yet')
  return bits.join(' · ')
}

export default function AvailabilityTab() {
  const [channels, setChannels] = useState<ChannelOpt[]>([])
  const [channelId, setChannelId] = useState<string | null>(null)
  const [data, setData] = useState<Payload | null>(null)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState<'all' | RegionName>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/internal/youtube-channels').then(r => r.json()).then((j: { channels: ChannelOpt[] }) => {
      setChannels(j.channels)
      if (j.channels[0]) setChannelId(j.channels[0].id)
    }).catch(e => setError(String(e)))
  }, [])

  const load = useCallback(async () => {
    if (!channelId) return
    setError(null)
    try {
      const res = await fetch(`/api/internal/channel-region-rules?channelId=${channelId}`)
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      setData(await res.json() as Payload)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [channelId])

  useEffect(() => { load() }, [load])

  const blockCountries = useCallback(async (countries: string[], source: string) => {
    if (!channelId || countries.length === 0) return
    await fetch('/api/internal/channel-region-rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, countries, source }),
    })
    await load()
  }, [channelId, load])

  const unblock = useCallback(async (id: string) => {
    await fetch(`/api/internal/channel-region-rules?id=${id}`, { method: 'DELETE' })
    await load()
  }, [load])

  const filteredRules = useMemo(() => {
    if (!data) return []
    return data.rules.filter(r => {
      if (search && !r.country_iso2.includes(search.toLowerCase())) return false
      if (regionFilter !== 'all' && regionForCountry(r.country_iso2) !== regionFilter) return false
      return true
    })
  }, [data, search, regionFilter])

  return (
    <div className="ui-page">
      <PageHeader
        title="Availability by Country"
        subtitle="Block a channel's live YouTube stream where another company owns the rights — viewers there see the local broadcaster instead."
        actions={<Button variant="primary" onClick={() => setDialogOpen(true)} disabled={!channelId}>+ Block more countries</Button>}
      />

      {error && <div style={{ color: 'var(--live-text)', fontSize: 13, marginBottom: 12 }}>Error: {error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18 }}>
        <span className="ui-section-label">Channel</span>
        {channels.map(c => (
          <button key={c.id} className="ui-chip" data-on={c.id === channelId} onClick={() => setChannelId(c.id)}>{c.name}</button>
        ))}
      </div>

      {data && data.suggestions.length > 0 && (
        <div className="ui-panel" style={{ borderColor: 'var(--orange-border)', background: 'var(--orange-bg)', marginBottom: 22 }}>
          <div className="ui-panel-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13 }}>We found {data.suggestions.length} countries that may need to be blocked</strong>
              <Button size="sm" variant="primary" onClick={() => blockCountries(data.suggestions.map(s => s.country), 'yt_api')}>
                Block all {data.suggestions.length}
              </Button>
            </div>
            {data.suggestions.map(s => (
              <div key={s.country} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--border-inner)', fontSize: 13 }}>
                <span><strong>{s.country.toUpperCase()}</strong> — <span style={{ color: 'var(--text-2)' }}>{reasonText(s)}</span></span>
                <Button size="sm" onClick={() => blockCountries([s.country], s.reasons.includes('yt_api') ? 'yt_api' : 'broadcaster')}>
                  Block {s.country.toUpperCase()}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <input className="ui-input" placeholder="Search blocked countries…" style={{ flex: 1 }} value={search} onChange={e => setSearch(e.target.value)} />
        <select className="ui-select" style={{ width: 200 }} value={regionFilter} onChange={e => setRegionFilter(e.target.value as 'all' | RegionName)}>
          <option value="all">All regions</option>
          {REGION_NAMES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead><tr><th>Country</th><th>How it was added</th><th>Viewers here watch on</th><th>Note</th><th /></tr></thead>
          <tbody>
            {filteredRules.map(r => (
              <tr key={r.id}>
                <td>{r.country_iso2.toUpperCase()}</td>
                <td><span className="ui-pill" data-tone={r.source === 'yt_api' ? 'men' : 'neutral'}>{SOURCE_LABEL[r.source] ?? r.source}</span></td>
                <td style={{ color: 'var(--text-2)' }}>{(data?.watchOn[r.country_iso2] ?? []).join(' · ') || '—'}</td>
                <td style={{ color: 'var(--text-3)' }}>{r.note ?? '—'}</td>
                <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" onClick={() => unblock(r.id)}>Unblock</Button></td>
              </tr>
            ))}
            {filteredRules.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--text-3)', padding: 24, textAlign: 'center' }}>No blocked countries.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {dialogOpen && (
        <BlockDialog
          alreadyBlocked={new Set((data?.rules ?? []).map(r => r.country_iso2))}
          onClose={() => setDialogOpen(false)}
          onBlock={async (countries) => { await blockCountries(countries, 'manual'); setDialogOpen(false) }}
        />
      )}
    </div>
  )
}

function BlockDialog(props: {
  alreadyBlocked: Set<string>
  onClose: () => void
  onBlock: (countries: string[]) => void
}) {
  const [region, setRegion] = useState<RegionName>(REGION_NAMES[0])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const countries = countriesForRegion(region).filter(c => !props.alreadyBlocked.has(c))

  const toggle = (cc: string) => setPicked(p => {
    const next = new Set(p); next.has(cc) ? next.delete(cc) : next.add(cc); return next
  })

  return (
    <div className="ui-cmd-scrim" onClick={props.onClose}>
      <div className="ui-cmd" style={{ padding: 18 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Block more countries</h3>
        <div className="ui-section-label" style={{ marginBottom: 8 }}>Block an entire region at once</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {REGION_NAMES.map(r => (
            <button key={r} className="ui-chip" data-on={r === region}
              onClick={() => { setRegion(r); setPicked(new Set(countriesForRegion(r).filter(c => !props.alreadyBlocked.has(c)))) }}>
              {r} — {countriesForRegion(r).length}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
          {countries.map(cc => (
            <label key={cc} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '5px 7px' }}>
              <input type="checkbox" checked={picked.has(cc)} onChange={() => toggle(cc)} /> {cc.toUpperCase()}
            </label>
          ))}
          {countries.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 13 }}>All countries in this region are already blocked.</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{picked.size} selected</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={picked.size === 0} onClick={() => props.onBlock([...picked])}>Block {picked.size} countries</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
