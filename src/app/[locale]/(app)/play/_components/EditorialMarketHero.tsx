'use client'
import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { EditorialView } from '../../../../../../shared/play-editorial-view'
import styles from './EditorialMarketHero.module.css'

function Portrait({ player, large }: { player: EditorialView['players'][number]; large: boolean }) {
  const sources = [...new Set([large ? player.photoUrl : null, player.avatarUrl].filter((s): s is string => !!s))]
  const [failed, setFailed] = useState<string[]>([])
  const src = sources.find(s => !failed.includes(s))
  return <div className={styles.portrait}>
    {src ? <Image src={src} alt={player.name} fill sizes="(max-width: 500px) 40vw, 180px" onError={() => setFailed(f => [...f,src])} />
      : <span role="img" aria-label={player.name}>{player.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span>}
  </div>
}
export default function EditorialMarketHero({ data, compact = false }: { data: EditorialView; compact?: boolean }) {
  const t = useTranslations('play.editorial')
  const locale = useLocale()
  const ranking = data.kind === 'ranking'
  return <section className={`${styles.hero} ${ranking ? styles.ranking : styles.pair} ${compact ? styles.compact : ''}`} aria-label={t(data.kind)}>
    <div className={styles.people}>
      {data.players.map(player => <div className={styles.person} key={player.id}>
        <Link href={`/player/${player.id}`} prefetch={false} className={styles.playerLink} aria-label={player.name}><Portrait player={player} large={true} /></Link>
        {ranking && <Link href={`/player/${player.id}`} prefetch={false} className={styles.playerName}>{player.name}</Link>}
      </div>)}
      {ranking && <div className={styles.target}>
        <span>{t('current')}</span><b>{data.players[0]?.ranking ? `#${data.players[0].ranking}` : '—'}</b>
        <span>{t('target')}</span><b className={styles.goal}>{data.target ? `TOP ${data.target}` : '—'}</b>
      </div>}
    </div>
    {!ranking && <div className={styles.pairNames}>{data.players.map(player => <Link key={player.id} href={`/player/${player.id}`} prefetch={false} className={styles.playerName}>{player.name}</Link>)}</div>}
    {(!compact || data.kind === 'round') && <div className={styles.summary}>
      <strong>{data.kind === 'titles' && data.target ? t('titlesTarget',{count:data.target}) : t(data.kind)}</strong>
      {data.kind === 'titles' && data.completed != null && data.target && <progress aria-label={t('titles')} value={data.completed} max={data.target} />}
      {data.kind === 'titles' && data.completed != null && data.target && <b>{data.completed} / {data.target}</b>}
      {data.kind === 'round' && data.round && <b>{data.round === 'SF' || data.round === 'F' ? t(`roundName.${data.round}`) : data.round}</b>}
      {data.endsAt && <span>{t('until',{date:new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(data.endsAt))})}</span>}
    </div>}
    {!compact && data.scope && <p className={styles.scope} title={data.scope}>{data.scope}</p>}
  </section>
}
export function EditorialEstimate({ data }: { data: EditorialView }) {
  const t = useTranslations('play.editorial')
  const locale = useLocale()
  if (data.openingProbability === null) return null
  return <details className={styles.estimate}>
    <summary>{t('opening')} · {new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:0}).format(data.openingProbability)}</summary>
    <p>{data.source || t('sourceUnavailable')}</p><p>{t('estimateNote')}</p>
  </details>
}
