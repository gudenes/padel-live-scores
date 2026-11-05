'use client'
import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { FlagImage } from '@/components/FlagImage'
import { WORLD_CUP, type CupData } from '@/lib/world-cup'
import { worldCupTeamDestination, type CupLinkedMatch } from '@/lib/world-cup-team-link'

export default function WorldCupPairLink({ match, pair }: { match: CupLinkedMatch; pair: 1 | 2 }) {
  const locale = useLocale()
  const t = useTranslations('worldCup')
  const [data, setData] = useState<CupData | null>(null)
  const enabled = match.tournament?.id === WORLD_CUP.tournamentId
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetch('/api/world-cup', { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(data => { if (!controller.signal.aborted) setData(data) }).catch(() => {})
    return () => controller.abort()
  }, [enabled])
  const destination = worldCupTeamDestination(match, pair, data)
  if (!destination) return null
  const name = new Intl.DisplayNames([locale], { type: 'region' }).of(destination.country)
  return <Link href={destination.href} aria-label={`${name} · ${t('teamDetails')}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 32, color: '#fff', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>
    <FlagImage country={destination.country} size={16} />{name}<span aria-hidden="true">›</span>
  </Link>
}
