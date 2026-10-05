'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Pill } from '@/components/ui'
import type { TournamentSuggestion, TournamentSuggestions as SuggestionData } from '@/lib/play-tournament-suggestions'
import type { EditorialPreview } from '@/lib/play-editorial-service'
import styles from './TournamentSuggestions.module.css'

type ReviewedDraft = { id: string; revision: number; preview: EditorialPreview; preview_token: string; preview_expires_at: string }
const date = (iso: string) => Number.isFinite(Date.parse(iso))
  ? new Date(iso).toLocaleString('en-GB', { day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC' }) + ' UTC' : 'Time pending'
const percent = (p: number | null) => p !== null && Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '—'

async function editorialAction(body: Record<string, unknown>) {
  const response = await fetch('/api/internal/play-editorial', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error([data.error ?? 'Could not complete this action.', ...(data.details ?? [])].join(' '))
  return data
}

export default function TournamentSuggestions({ onPublished }: { onPublished: () => void }) {
  const [data,setData] = useState<SuggestionData | null>(null)
  const [eventId,setEventId] = useState('')
  const [deadline,setDeadline] = useState('')
  const [appliedDeadline,setAppliedDeadline] = useState('')
  const [draw,setDraw] = useState('all')
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [refresh,setRefresh] = useState(0)
  const [selected,setSelected] = useState<TournamentSuggestion | null>(null)
  const [review,setReview] = useState<ReviewedDraft | null>(null)
  const [busy,setBusy] = useState(false)
  const [reviewError,setReviewError] = useState('')
  const [message,setMessage] = useState('')
  const [now,setNow] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const sequence = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/internal/play-suggestions?${new URLSearchParams({...eventId ? {tournament:eventId} : {},...appliedDeadline ? {locksAt:appliedDeadline} : {}})}`, {cache:'no-store',signal:controller.signal})
      .then(async r => { const result = await r.json(); if (!r.ok) throw new Error(result.error); return result })
      .then(result => { setData(result); setError(''); setLoading(false) })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setLoading(false) } })
    return () => controller.abort()
  }, [eventId,refresh,appliedDeadline])
  useEffect(() => { const timer=setInterval(()=>setNow(Date.now()),15000); return ()=>clearInterval(timer) }, [])
  useEffect(() => { if (selected) dialog.current?.showModal(); else dialog.current?.close() }, [selected])
  const reload = useCallback(() => { setLoading(true); setError(''); setRefresh(n=>n+1) }, [])
  function close() {
    // Publishing must finish before another suggestion can be approved.
    if (inFlight.current) return
    sequence.current++; setSelected(null); setReview(null); setReviewError('')
  }
  async function prepare(item: TournamentSuggestion, previous?: ReviewedDraft | null) {
    if (inFlight.current) return
    const run = ++sequence.current
    inFlight.current = true; setBusy(true); setSelected(item); setReview(null); setReviewError('')
    try {
      const draft = previous ?? (await editorialAction({action:'save',config:item.config})).draft
      const result = await editorialAction({action:'preview',id:draft.id,revision:draft.revision})
      if (run === sequence.current) { setReview(result.draft); setNow(Date.now()) }
    } catch (e) { if (run === sequence.current) setReviewError(e instanceof Error ? e.message : 'Could not prepare this market.') }
    finally { inFlight.current=false; if (run === sequence.current) setBusy(false) }
  }
  async function approve() {
    if (!review || !selected || inFlight.current) return
    inFlight.current=true; setBusy(true); setReviewError('')
    try {
      const result = await editorialAction({action:'publish',id:review.id,revision:review.revision,token:review.preview_token})
      setData(current => current ? {...current,suggestions:current.suggestions.map(s=>s.id===selected.id?{...s,existingMarketId:result.marketId}:s)} : current)
      setMessage(`Published: ${review.preview.question.en}`)
      setSelected(null); setReview(null); onPublished()
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : 'Could not publish. Refresh the preview before trying again.')
      // Keep the token for an idempotent retry if the response was lost.
    } finally { inFlight.current=false; setBusy(false) }
  }
  const items = data?.suggestions.filter(s=>draw==='all'||s.config.category===draw) ?? []
  const ready = data?.suggestions.filter(s=>!s.existingMarketId&&!s.preview.errors.length).length ?? 0
  const expired = !!review && (Date.parse(review.preview_expires_at) <= now || Date.parse(review.preview.locksAt) <= now)
  return <section className={`ui-panel ${styles.panel}`} aria-labelledby="tournament-suggestions-title">
    <header className="ui-panel-head">
      <div><h2 className="ui-panel-title" id="tournament-suggestions-title">Tournament suggestions</h2><p className={styles.subtitle}>Review suggested markets before publishing.</p></div>
      <Pill tone={ready ? 'lime' : 'neutral'}>{ready} ready</Pill>
    </header>
    <div className="ui-panel-pad">
    <div className={styles.toolbar}>
      <label>Tournament<select className="ui-select" value={eventId || data?.tournamentId || ''} disabled={loading || busy} onChange={e=>{setLoading(true);setEventId(e.target.value);setDeadline('');setAppliedDeadline('');setMessage('')}}>
        {!data?.events.length&&<option value="">Upcoming tournaments</option>}
        {data?.events.map(t=><option key={t.id} value={t.id}>{t.name} · {t.starts_at.slice(0,10)}</option>)}
      </select></label>
      <label>Draw<select className="ui-select" value={draw} onChange={e=>setDraw(e.target.value)}><option value="all">Both draws</option><option value="men">Men</option><option value="women">Women</option></select></label>
      <Button type="button" size="sm" disabled={loading || busy} onClick={reload}>Refresh suggestions</Button>
    </div>
    <div className={styles.toolbar}>
      <label>Pre-draw closing deadline (UTC)<input className="ui-input" type="datetime-local" value={deadline} disabled={loading||busy} onChange={e=>setDeadline(e.target.value)} /></label>
      <Button type="button" size="sm" disabled={loading||busy||!deadline} onClick={()=>{const value=Date.parse(deadline+'Z');if(!Number.isFinite(value)||value<=Date.now()){setError('Choose a future closing deadline in UTC.');return;}setLoading(true);setAppliedDeadline(new Date(value).toISOString());setRefresh(n=>n+1)}}>Apply deadline</Button>
    </div>
    <p className={styles.footnote}>Open from the draw before match times are available. Choose a deadline before expected play; these markets close earlier if any main-draw match starts or is scheduled earlier. Applying a deadline does not publish anything.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.success}>{message}</p>}
    {loading ? <div className={styles.grid} aria-busy="true" aria-label="Loading tournament suggestions">{Array.from({length:4},(_,i)=><div key={i} className={`${styles.card} ${styles.skeleton}`}><span>Checking the draw…</span></div>)}</div>
      : !error && <>
        {!items.length ? <div className={styles.empty}><h3>No suggestions yet</h3><p>This draw needs tournament projections with confirmed pairs. Refresh after the draw and model have updated, or choose another tournament.</p></div>
        : <div className={styles.grid}>{items.map(item=>{
          const p=item.preview, published=!!item.existingMarketId, blocked=p.errors.length>0
          return <article key={item.id} className={styles.card} data-state={published?'published':blocked?'waiting':'ready'}>
            <div className={styles.cardTop}><span className={styles.kind}>{item.config.category==='men'?'MEN':'WOMEN'} · {item.config.family==='champion'?'CHAMPION':item.config.round==='F'?'FINALIST':'SEMIFINALIST'}</span><Pill tone={published?'neutral':blocked?'warn':'lime'}>{published?'Published':blocked?'Waiting':'Ready'}</Pill></div>
            <h3>{p.question.en}</h3><p className={styles.reason}>{item.reason}</p>
            <div className={styles.cardBottom}><div className={styles.pricing}><div><span>Opening YES</span><strong>{percent(p.probability)}</strong></div><div><span>Closes</span><b>{date(p.locksAt)}</b></div></div>
              {blocked&&!published&&<p className={styles.blocker} title={p.errors.join(' ')}>{p.errors[0]}{p.errors.length>1?` (+${p.errors.length-1} more)`:''}</p>}
              <Button type="button" size="sm" disabled={busy||published} onClick={()=>void prepare(item)}>{published?'Already published':blocked?'View requirements':'Review & approve'}</Button>
            </div>
          </article>
        })}</div>}
        <p className={styles.footnote}>Up to four picks per draw · 5,000 Guacas maximum subsidy each · Nothing publishes automatically.</p>
      </>}
    </div>
    <dialog ref={dialog} className={styles.dialog} onCancel={e=>{e.preventDefault();close()}} onClose={()=>{if(!inFlight.current)setSelected(null)}} aria-labelledby="suggestion-review-title">
      {selected&&<div className={styles.review}>
        <div className={styles.reviewHeader}><div><h2 id="suggestion-review-title">{review?.preview.question.en ?? selected.preview.question.en}</h2></div></div>
        {busy&&!review&&<p role="status">Checking the latest price, closing deadline and result evidence…</p>}
        {review&&<>
          <div className={styles.reviewStats}><div><span>Opening YES</span><strong>{percent(review.preview.probability)}</strong></div><div><span>Trading closes</span><b>{date(review.preview.locksAt)}</b></div><div><span>Max. subsidy</span><b>{review.preview.maxLoss.toLocaleString()} G</b></div></div>
          {review.preview.evidence?.closingPolicy && <p className={styles.footnote}>Pre-draw market: closes at the reviewed deadline or earlier when the main draw starts. Later schedule changes cannot extend trading.</p>}
          <h3>How this settles</h3><p className={styles.rules}>{review.preview.rules.en}</p>
          <details><summary>Price source and translated question</summary><p className={styles.rules}>{review.preview.priceSource || 'A current projection is required.'}</p><p>{review.preview.question.es}</p></details>
          {!!review.preview.errors.length&&<div className={styles.requirements}><h3>Needed before approval</h3><ul>{review.preview.errors.map(e=><li key={e}>{e}</li>)}</ul></div>}
          {expired&&<p role="status" className={styles.error}>This preview has expired. Refresh it before approving.</p>}
          {!data?.publishingEnabled&&<p className={styles.error}>Publishing is disabled. The draft is saved for review.</p>}
          <p className={styles.footnote}>Approving opens this market to eligible Play members. The price and deadline are checked again when you approve.</p>
        </>}
        {reviewError&&<p role="alert" className={styles.error}>{reviewError}</p>}
        <div className={styles.reviewActions}>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={close}>Close</Button>
          {review&&<Button type="button" size="sm" disabled={busy} onClick={()=>void prepare(selected,review)}>Refresh preview</Button>}
          <Button type="button" size="sm" variant="primary" disabled={busy||!review||expired||!!review.preview.errors.length||!data?.publishingEnabled} onClick={()=>void approve()}>{busy?'Checking…':'Approve & publish'}</Button>
        </div>
      </div>}
    </dialog>
  </section>
}
