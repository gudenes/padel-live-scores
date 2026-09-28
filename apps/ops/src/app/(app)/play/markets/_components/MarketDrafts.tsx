'use client'

import { useEffect, useState } from 'react'
import { Panel, Pill } from '@/components/ui'
import { draftBlockers, matchReady, type MarketDraft, type MatchCandidate } from '@/lib/play-market-drafts'

const LABELS = { 'tournament-bagel': 'Tournament · Bagel watch', 'daily-match': 'Daily · Match of the day', partnership: 'Long term · Partnership' }
const field = { display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-2)' } as const
const input = { width: '100%', padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg-input)', color: 'var(--text-1)', font: 'inherit' } as const

export default function MarketDrafts() {
  const [drafts, setDrafts] = useState<MarketDraft[]>([])
  const [matches, setMatches] = useState<MatchCandidate[]>([])
  const [selected, setSelected] = useState<string>('rotterdam-bagel')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/internal/play-drafts', { signal: controller.signal, cache: 'no-store' })
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error); return data })
      .then(data => { setDrafts(data.drafts); setMatches(data.matches) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [])
  const draft = drafts.find(d => d.id === selected)
  function change(patch: Partial<MarketDraft>) {
    setDrafts(items => items.map(d => d.id === selected ? { ...d, ...patch } : d))
    setMessage('')
  }
  async function save() {
    if (!draft) return
    setSaving(true); setError(''); setMessage('')
    try {
      const res = await fetch('/api/internal/play-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDrafts(items => items.map(d => d.id === data.draft.id ? data.draft : d))
      setMessage('Draft saved on this Mac. It is not open for positions.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') }
    finally { setSaving(false) }
  }
  const blockers = draft ? draftBlockers(draft, matches) : []
  return <Panel>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>New markets</h2><Pill tone="warn">Local drafts</Pill>
    </div>
    <p className="hint">Prepare the question, scope and resolution rules before opening a market.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}>
      {drafts.map(d => <button type="button" key={d.id} className="ui-chip" data-on={selected === d.id} aria-pressed={selected === d.id} onClick={() => { setSelected(d.id); setMessage('') }}>{LABELS[d.kind]}</button>)}
    </div>
    {draft && <div style={{ display: 'grid', gap: 16 }}>
      <label style={field}>Market question<input style={input} value={draft.title} maxLength={240} onChange={e => change({ title: e.target.value })} /></label>
      {draft.kind === 'tournament-bagel' && <label style={field}>Main draws<select style={input} value={draft.category} onChange={e => change({ category: e.target.value as MarketDraft['category'] })}><option value="both">Men + women</option><option value="men">Men</option><option value="women">Women</option></select></label>}
      {draft.kind === 'daily-match' && <label style={field}>Rotterdam main-draw match<select style={input} value={draft.matchId ?? ''} onChange={e => {
        const m = matches.find(item => item.id === e.target.value)
        change({ matchId: m?.id ?? null, closesAt: m?.scheduledAt ?? null, openingProbability: m?.probability ?? null,
          probabilitySource: m?.probability != null ? 'Current match model: first pair win probability.' : '',
          title: m ? `Will ${m.title.split(' vs ')[0]} win the match of the day?` : 'Match of the day' })
      }}><option value="">Choose a match</option>{matches.map(m => <option key={m.id} value={m.id}>{m.round} · {m.title} · {m.scheduledAt ? new Date(m.scheduledAt).toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam' }) : 'Time pending'}{matchReady(m) ? '' : ' · Not ready'}</option>)}</select><span>Times: Europe/Amsterdam. {matches.filter(m => matchReady(m)).length} matches ready. You can save a pick while its start time is pending.</span></label>}
      {draft.kind !== 'daily-match' && <label style={field}>Latest trading deadline (UTC)<input style={input} type="datetime-local" step={1} value={draft.closesAt?.slice(0,19) ?? ''} onChange={e => change({ closesAt: e.target.value ? new Date(`${e.target.value}Z`).toISOString() : null })} /><span>{draft.kind === 'partnership' ? 'December 8, 23:59:59 Madrid = 22:59:59 UTC. The wording must use the same deadline.' : 'October 4, end of day in Rotterdam. A confirmed bagel or the end of play closes trading sooner.'}</span></label>}
      <label style={field}>Resolution rules<textarea style={{ ...input, resize: 'vertical', lineHeight: 1.6 }} rows={6} value={draft.rules} maxLength={5000} onChange={e => change({ rules: e.target.value })} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12 }}>
        <label style={field}>Opening YES (%)<input style={input} type="number" min={2} max={98} step="0.1" value={draft.openingProbability === null ? '' : Math.round(draft.openingProbability * 1000) / 10} placeholder="Not set" onChange={e => change({ openingProbability: e.target.value === '' ? null : Number(e.target.value) / 100 })} /></label>
        <label style={field}>Probability source<input style={input} value={draft.probabilitySource} maxLength={1000} placeholder="Model, historical sample, or explicit editorial estimate" onChange={e => change({ probabilitySource: e.target.value })} /></label>
      </div>
      {draft.kind === 'tournament-bagel' && <p className="hint" style={{ margin: 0 }}>Update the forecast from the remaining main-draw matches as results arrive. Keep that forecast separate from the trading price and existing positions. A full-tournament “any bagel” may be heavily favoured; review the estimate before choosing the opening odds.</p>}
      <div style={{ padding: 12, background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 5 }}>
        <strong style={{ fontSize: 12 }}>Before this market can open</strong>
        <ul style={{ fontSize: 12, lineHeight: 1.7, paddingLeft: 18, marginBottom: 0 }}>
          {blockers.map(b => <li key={b}>{b}</li>)}
          <li>Publish support is not connected in this draft editor. Saving does not create a tradable market.</li>
        </ul>
      </div>
      <div><button type="button" className="ui-btn" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save local draft'}</button></div>
    </div>}
    {error && <p role="alert" style={{ color: 'var(--live-text)' }}>{error}</p>}
    {message && <p role="status" style={{ color: 'var(--text-2)' }}>{message}</p>}
  </Panel>
}
