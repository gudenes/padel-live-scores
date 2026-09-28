'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader, Panel, Pill, Button } from '@/components/ui'

type State = {
  paused: number; bots: number; bot_limit: number; interval_ms: number; worker_seen: number; trades: number
  audit: { ok: boolean }
  limits: { botDaily: number; marketDaily: number; botMarket: number; maxStake: number; maxDrift: number }
  markets: { id: string; question: string; status: string; priceYes: number; locks_at: number }[]
  activity: { id: string; displayName: string; question: string; side: string; guacas: number; createdAt: string }[]
}

export default function SimulationPanel() {
  const [data, setData] = useState<State | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [observedAt, setObservedAt] = useState(0)
  const [count, setCount] = useState('50')
  const [seconds, setSeconds] = useState('15')
  const initialized = useRef(false)
  const writing = useRef(false)
  const version = useRef(0)
  const load = useCallback(async () => {
    if (writing.current) return
    const requestVersion = version.current
    try {
      const res = await fetch('/api/internal/play-simulation', { cache: 'no-store' })
      const json = await res.json()
      if (requestVersion !== version.current) return
      if (!res.ok) throw new Error(json.error)
      setData(json); setObservedAt(Date.now()); setError('')
      if (!initialized.current) {
        setCount(String(json.bot_limit)); setSeconds(String(json.interval_ms / 1000)); initialized.current = true
      }
    } catch (e) { if (requestVersion === version.current) setError(e instanceof Error ? e.message : 'Could not refresh status') }
  }, [])
  useEffect(() => {
    const firstLoad = setTimeout(() => void load(), 0)
    const timer = setInterval(() => { if (!document.hidden) void load() }, 5000)
    return () => { clearTimeout(firstLoad); clearInterval(timer) }
  }, [load])

  async function change(action: 'configure' | 'pause' | 'resume') {
    if (writing.current) return
    writing.current = true; version.current++; setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch('/api/internal/play-simulation', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, count: Number(count), intervalSeconds: Number(seconds) }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setData(json); setObservedAt(Date.now())
      setNotice(action === 'configure' ? 'Settings saved.' : action === 'pause' ? 'Simulation paused.' : 'Simulation enabled. Trades require a connected worker.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed') }
    finally { writing.current = false; setBusy(false) }
  }
  const online = !error && !!data && observedAt - data.worker_seen < 10000
  const valid = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 1000
    && Number.isInteger(Number(seconds)) && Number(seconds) >= 5 && Number(seconds) <= 300
  const inputStyle = { padding: '10px', background: 'var(--bg-card, #202020)', color: 'inherit', border: '1px solid var(--border, #444)', width: '100%' }

  return <div className="ui-page">
    <PageHeader title="Simulation" subtitle="Adjust the local bot pilot. Simulated balances and activity stay separate from human markets, rankings and prizes." />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      <Pill tone="warn">Local only</Pill><Pill>Prize eligibility: excluded</Pill>
      {data && <><Pill tone={data.paused ? 'neutral' : online ? 'lime' : 'warn'}>{data.paused ? 'Paused' : online ? 'Running' : 'Enabled · worker offline'}</Pill>
        <Pill tone={online ? 'lime' : 'warn'}>Worker {online ? 'connected' : 'offline'}</Pill>
        <Pill tone={data.audit.ok ? 'lime' : 'urgent'}>Balance audit {data.audit.ok ? 'passed' : 'needs attention'}</Pill></>}
    </div>
    {error && <p role="alert" style={{ color: '#ff8b78' }}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!data ? <Panel title="Simulation status"><p>{error ? 'Status unavailable.' : 'Loading simulation…'}</p><Button onClick={() => void load()}>Refresh</Button></Panel> : <>
      <Panel title="Controls" actions={<Button disabled={busy} variant={data.paused ? 'primary' : 'default'} onClick={() => void change(data.paused ? 'resume' : 'pause')}>{data.paused ? 'Resume simulation' : 'Pause simulation'}</Button>}>
        <form onSubmit={event => { event.preventDefault(); void change('configure') }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 24 }}>
            <label>Active bots<input style={inputStyle} type="number" min="1" max="1000" step="1" value={count} onChange={event => setCount(event.target.value)} required disabled={busy} /><small>1–1,000. Lowering this keeps all balances and history.</small></label>
            <label>Average interval (seconds)<input style={inputStyle} type="number" min="5" max="300" step="1" value={seconds} onChange={event => setSeconds(event.target.value)} required disabled={busy} /><small>One attempt across all bots, with ±25% timing variation.</small></label>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 20 }}><Button type="submit" variant="primary" disabled={busy || !valid}>{busy ? 'Saving…' : 'Save settings'}</Button><span>{data.bots} accounts created · {data.trades} trades</span></div>
        </form>
        {!online && <p>Start the local worker from the project root: <code>npm run play:sim -- run</code>. Enabling the simulation does not start a process.</p>}
      </Panel>
      <Panel title="Trading limits">
        <p>{data.limits.maxStake} G per trade · {data.limits.botDaily} G per bot/day · {data.limits.marketDaily} G per market/day · {data.limits.botMarket} G per bot/market</p>
        <p>Maximum price movement: {Math.round(data.limits.maxDrift * 100)} percentage points from the starting price. Limits remain fixed for this pilot. Daily budgets reset at midnight UTC.</p>
      </Panel>
      <Panel title="Simulation markets">
        {data.markets.map(m => <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: '1px solid #333' }}><span>{m.question}</span><span>{m.status === 'open' && m.locks_at <= observedAt ? 'locked' : m.status} · Yes {(m.priceYes * 100).toFixed(1)}%</span></div>)}
      </Panel>
      <Panel title="Recent simulated activity">
        {!data.activity.length && <p>No simulated trades yet.</p>}
        {data.activity.slice(0, 10).map(trade => <div key={trade.id} style={{ padding: '12px 0', borderBottom: '1px solid #333' }}><Pill>Bot</Pill> <strong>{trade.displayName}</strong> · {trade.side === 'yes' ? 'Yes' : 'No'} · {trade.guacas} G <small>{new Date(trade.createdAt).toLocaleTimeString()}</small><div>{trade.question}</div></div>)}
      </Panel>
    </>}
  </div>
}
