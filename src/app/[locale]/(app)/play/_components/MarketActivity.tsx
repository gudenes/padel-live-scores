'use client'

import GuacaCoin from '@/components/GuacaCoin'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { PlayerAvatar, usePlayerOutfit } from '@/components/PlayerAvatar'
import Avatar from '@/components/Avatar'
import { simulationPlayerLook } from '@/lib/player-outfit'
import { formatGuacas, relativeShort } from './shared'
import { parseActivity, type PlayMarket, type PlayTrade } from './types'
import styles from './MarketActivity.module.css'

export function TradeAvatar({ trade, size = 42 }: { trade: PlayTrade; size?: number }) {
  const { outfit } = usePlayerOutfit(trade.isMe ? trade.userId ?? undefined : undefined)
  if (outfit) return <PlayerAvatar outfit={outfit} size={size} />
  if (trade.avatarUrl) return <Avatar src={trade.avatarUrl} alt="" size={size} />
  return <PlayerAvatar outfit={trade.isSimulation ? simulationPlayerLook(trade.avatarSeed || trade.displayName) : 'starter'} size={size} />
}

export default function MarketActivity({ market }: { market: PlayMarket }) {
  const t = useTranslations('play')
  const locale = useLocale()
  const root = useRef<HTMLElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const [trades, setTrades] = useState<PlayTrade[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  const [mine, setMine] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let visible = false
    let stopped = false
    let controller: AbortController | null = null
    async function refresh() {
      // Keep an open sheet stable while someone is reading it.
      if (!visible || document.hidden || dialog.current?.open || controller) return
      controller = new AbortController()
      try {
        const response = await fetch(`/api/play/activity?locale=${locale}&marketId=${encodeURIComponent(market.id)}`, { signal: controller.signal })
        if (!response.ok) throw new Error('activity unavailable')
        const result = parseActivity(await response.json())
        if (!stopped) { setTrades(result); setStatus('ready'); setNow(Date.now()) }
      } catch {
        if (!stopped) setStatus('error')
      } finally { controller = null }
    }
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) void refresh() })
    if (root.current) observer.observe(root.current)
    const timer = setInterval(() => { setNow(Date.now()); void refresh() }, 30_000)
    const onVisible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { stopped = true; controller?.abort(); observer.disconnect(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [market.id, locale, retry])

  const timeLabels = { now: t('time.now'), s: (n: number) => t('time.seconds', { n }), m: (n: number) => t('time.minutes', { n }), h: (n: number) => t('time.hours', { n }), d: (n: number) => t('time.days', { n }) }
  function rows(items: PlayTrade[]) {
    return <ul className={styles.list}>{items.map(trade => <li className={styles.trade} key={trade.id} data-mine={trade.isMe}>
      <TradeAvatar trade={trade} />
      <div className={styles.identity}><strong>{trade.isMe ? t('courtside.you') : trade.displayName || t('activity.someone')}</strong>
        <small>{trade.isSimulation && <>{t('courtside.simulated')} · </>}{relativeShort(trade.createdAt, now, timeLabels)}</small>
        {trade.direction === 'sell' && <small>{t('activity.sold')}</small>}
      </div>
      <span className={styles.side} data-side={trade.side}>{t(`deck.${trade.side}`)}</span>
      <strong className={styles.amount}>{formatGuacas(trade.guacas, locale)} <GuacaCoin size={24} /></strong>
    </li>)}</ul>
  }
  const filtered = mine ? trades.filter(trade => trade.isMe) : trades
  return <section className={styles.root} ref={root} aria-label={t('courtside.title')}>
    <div className={styles.heading}><h3>{t('courtside.title')}</h3>
      <button disabled={status !== 'ready' && !trades.length} onClick={() => { setMine(false); dialog.current?.showModal() }} className={styles.more}>{t('courtside.all')} <span aria-hidden>↗</span></button>
    </div>
    {status === 'loading' && <p className={styles.message} role="status">{t('courtside.loading')}</p>}
    {status === 'error' && <button className={styles.retry} onClick={() => setRetry(n => n + 1)}>{t('courtside.error')} · {t('error.retry')}</button>}
    {status === 'ready' && trades.length === 0 && <p className={styles.message}>{t('courtside.empty')}</p>}
    {rows(trades.slice(0, 2))}
    <dialog ref={dialog} className={`pl-trade-dialog pl-amount-dialog ${styles.dialog}`} aria-label={t('courtside.title')} onClick={e => { if (e.target === e.currentTarget) dialog.current?.close() }}>
      <div className="pl-trade-content">
        <div className="pl-sheet-head"><div><h3>{t('courtside.title')}</h3><p>{market.question}</p></div><button className="pl-x" onClick={() => dialog.current?.close()} aria-label={t('detail.close')}>×</button></div>
        <div className={styles.filters} role="group" aria-label={t('subnav.activity')}><button aria-pressed={!mine} onClick={() => setMine(false)}>{t('subnav.activity')}</button><button aria-pressed={mine} onClick={() => setMine(true)}>{t('subnav.mine')}</button></div>
        {rows(filtered)}
        {!filtered.length && <p className={styles.message}>{t(mine ? 'courtside.noOwn' : 'courtside.empty')}</p>}
        {!mine && trades.some(trade => trade.isSimulation) && <p className={styles.message}>{t('courtside.simulationNote')}</p>}
      </div>
    </dialog>
  </section>
}
