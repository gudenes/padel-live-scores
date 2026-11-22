'use client'

import { useTranslations } from 'next-intl'
import { canonicalPointsRound, mainDrawDestination } from '@/lib/live-race/round-progression'
import styles from './MatchPointsBracket.module.css'

export default function MatchPointsBracket({ round, nextRound, qualifying, points, loserPoints }: {
  round?: string | null; nextRound?: string; qualifying: boolean; points: number; loserPoints: number;
}) {
  const t = useTranslations('raceStandings')
  const current = canonicalPointsRound(round)
  const next = qualifying ? canonicalPointsRound(nextRound) : mainDrawDestination(current)
  const label = (value: string) => /^Q[1-4]$/.test(value) ? value : t(`bracket.rounds.${value}`)
  const mainDraw = qualifying && next?.startsWith('R')
  return <section className={styles.bracket} aria-label={t('bracket.title')}>
    <div className={styles.current}>
      <span>{t('bracket.thisRound')}</span>
      <strong>{current ? label(current) : round || t('pointsVisual.title')}</strong>
    </div>
    <div className={styles.connectors} aria-hidden="true"><i /><i /></div>
    <div className={styles.outcomes}>
      <div className={styles.win}>
        <span className={styles.pathLabel}>↗ {t('bracket.win')}</span>
        <strong className={styles.destination}>{next === 'W' ? '🏆 ' : ''}{next ? label(next) : t('bracket.nextRound')}</strong>
        {mainDraw && <span className={styles.mainDraw}>{t('bracket.mainDraw')}</span>}
        <div className={styles.points}>{points}<small> pts</small></div>
        <span className={styles.perPlayer}>{t('pointsVisual.perPlayer')}</span>
        <span className={styles.caption}>✓ {t('bracket.secured')}</span>
      </div>
      <div className={styles.loss}>
        <span className={styles.pathLabel}>↘ {t('bracket.lose')}</span>
        <strong className={styles.destination}>{t('bracket.exit')}</strong>
        {current && <span className={styles.exitRound}>{label(current)}</span>}
        <div className={styles.points}>{loserPoints}<small> pts</small></div>
        <span className={styles.perPlayer}>{t('pointsVisual.perPlayer')}</span>
        <span className={styles.caption}>{t('bracket.total')}</span>
      </div>
    </div>
  </section>
}
