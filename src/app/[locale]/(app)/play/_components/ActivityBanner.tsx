'use client'

import GuacaCoin from '@/components/GuacaCoin'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { TradeAvatar } from './MarketActivity'
import { parseActivity, type PlayTrade } from './types'
import { formatGuacas, relativeShort } from './shared'
import styles from './ActivityBanner.module.css'

export default function ActivityBanner({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const t = useTranslations('play')
  const locale = useLocale()
  const newest = useRef<string | undefined>(undefined)
  const [rows, setRows] = useState<PlayTrade[]>([])
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || hovered) return
    let cancelled = false
    let pending: AbortController | null = null
    async function refresh() {
      if (document.hidden || pending) return
      pending = new AbortController()
      try {
        const response = await fetch(`/api/play/activity?locale=${locale}`, { signal: pending.signal })
        if (!response.ok) throw new Error('activity unavailable')
        const next = parseActivity(await response.json())
        if (!cancelled) { if (newest.current !== next[0]?.id) { newest.current = next[0]?.id; setIndex(0) } setRows(next); setFailed(false); setLoaded(true); setNow(Date.now()) }
      } catch { if (!cancelled) { setFailed(true); setLoaded(true) } }
      finally { pending = null }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30_000)
    const visibility = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visibility)
    return () => { cancelled = true; pending?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [active, hovered, locale])
  useEffect(() => {
    if (!active || hovered || rows.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => { if (!document.hidden) { setIndex(n => (n + 1) % rows.length); setNow(Date.now()) } }, 4000)
    return () => clearInterval(timer)
  }, [active, hovered, rows.length])
  const trade = rows[index % Math.max(rows.length, 1)]
  const timeLabels = { now: t('time.now'), s: (n: number) => t('time.seconds', { n }), m: (n: number) => t('time.minutes', { n }), h: (n: number) => t('time.hours', { n }), d: (n: number) => t('time.days', { n }) }
  return <section className={styles.banner} aria-label={t('ticker.title')} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setHovered(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false) }}>
    <button className={styles.entry} onClick={onOpen} aria-label={t('ticker.open')}>
      {trade ? <div className={styles.content} key={trade.id}>
        <TradeAvatar trade={trade} size={32} />
        <div className={styles.copy}>
          <div className={styles.line}><strong>{trade.isMe ? t('courtside.you') : trade.displayName || t('activity.someone')}</strong><span className={styles.side} data-side={trade.side}>{t(`deck.${trade.side}`)}</span><b>{formatGuacas(trade.guacas, locale)} <GuacaCoin size={16} /></b>{trade.isSimulation && <span className={styles.simulated}>{t('courtside.simulated')}</span>}</div>
          <div className={styles.meta}><span className={styles.question}>{trade.question}</span><small>{trade.marketStatus && trade.marketStatus !== 'open' && <>{t('results.closed')} · </>}{trade.direction === 'sell' && <>{t('activity.sold')} · </>}{failed ? t('courtside.error') : relativeShort(trade.createdAt, now, timeLabels)}</small></div>
        </div><span className={styles.arrow} aria-hidden>↗</span>
      </div> : <span className={styles.empty}>{t(failed ? 'courtside.error' : loaded ? 'ticker.empty' : 'courtside.loading')}</span>}
    </button>
  </section>
}
