'use client'
import { useEffect, useMemo, useState } from 'react'
import './../live-odds.css'
import { useLiveOdds } from '../_lib/useLiveOdds'
import { KpiRow } from './KpiRow'
import { LiveMatchesTable } from './LiveMatchesTable'
import { DetailPanel } from './DetailPanel'

function useClock() {
  const [t, setT] = useState('09:42:18')
  useEffect(() => {
    let d = new Date(); d.setHours(9, 42, 18, 0)
    const id = setInterval(() => { d = new Date(d.getTime() + 1000); setT(d.toTimeString().slice(0, 8)) }, 1000)
    return () => clearInterval(id)
  }, [])
  return t
}

export function LiveOddsView() {
  const { snapshot, connection, retry, cycleConnection, autoRefresh, setAutoRefresh, selectedId, setSelectedId, filters, setFilters } = useLiveOdds()
  const clock = useClock()

  // wire rail footer demo cycle (rail lives in shell; attach by id)
  useEffect(() => {
    const el = document.getElementById('railFoot'); if (!el) return
    const h = () => cycleConnection(); el.addEventListener('click', h); return () => el.removeEventListener('click', h)
  }, [cycleConnection])

  const matches = snapshot?.matches ?? []
  const filtered = useMemo(() => matches.filter(m => {
    if (filters.gender !== 'all' && m.pair1.gender !== filters.gender) return false
    if (filters.status === 'live' && m.status !== 'Live') return false
    if (filters.status === 'break' && m.status !== 'Break') return false
    if (filters.status === 'scheduled' && m.status !== 'Scheduled') return false
    if (filters.swingingOnly && Math.abs(m.movement15m) < 5) return false
    return true
  }), [matches, filters])
  const selected = matches.find(m => m.id === selectedId) ?? matches[0]

  const modelPill = connection === 'live' ? 'Model live' : connection === 'reconnecting' ? 'Model stale' : connection === 'offline' ? 'Model frozen' : 'Connecting'

  return (
    <>
      <div className="pagehead">
        <span className="crumb">Live Odds<span className="modelpill" id="mpTx"><span className="dot" />{modelPill}</span></span>
        <span className="spacer" />
        <span className={`toggle ${autoRefresh ? 'on' : ''}`} onClick={() => setAutoRefresh(a => !a)}>Auto-refresh <span className="sw" /></span>
        <span className="clock mono">{clock}<span className="upd"> · upd 2s</span></span>
      </div>
      <div className="pagebody">
        {snapshot && <KpiRow kpis={snapshot.kpis} />}
        <div className="content2">
          <LiveMatchesTable matches={filtered} selectedId={selected?.id ?? null} onSelect={setSelectedId}
            connection={connection} filters={filters} setFilters={setFilters} onRetry={retry} />
          {selected && <DetailPanel m={selected} />}
        </div>
        <div className="foot">Model odds are <b>PadelNachos-computed</b> from live match state — no external bookmaker data. Internal tool · operators only.</div>
      </div>
    </>
  )
}
