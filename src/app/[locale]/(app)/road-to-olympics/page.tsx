// src/app/[locale]/(app)/road-to-olympics/page.tsx
//
// Public hub. Server component, force-dynamic (counters change frequently;
// AppHeader project rule).

import { createClient } from '@supabase/supabase-js'
import { getTranslations } from 'next-intl/server'
import GlobalHeader from '@/components/nav/GlobalHeader'
import HubHero from '@/components/road-to-olympics/HubHero'
import CountdownCard from '@/components/road-to-olympics/CountdownCard'
import CriteriaScorecard from '@/components/road-to-olympics/CriteriaScorecard'
import BeatsFeed from '@/components/road-to-olympics/BeatsFeed'
import DecisionMakersDossier from '@/components/road-to-olympics/DecisionMakersDossier'
import ActionHub from '@/components/road-to-olympics/ActionHub'
import PledgeInline from '@/components/road-to-olympics/PledgeInline'
import DisclosureFooter from '@/components/road-to-olympics/DisclosureFooter'
import {
  computeDaysUntil,
  derivePillStatus,
  getCriteria,
  getDecisionMakers,
  getState,
} from '@/lib/road-to-olympics/state'
import { buildTweetIntentUrl } from '@/lib/road-to-olympics/share-copy'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('roadToOlympics')
  return {
    title: `${t('heroTitleLine1')} — PadelNachos`,
    description: t('heroSubtitle'),
    openGraph: {
      title: `${t('heroTitleLine1')} — PadelNachos`,
      description: t('heroSubtitle'),
      url: 'https://padelnachos.com/road-to-olympics',
    },
  }
}

export default async function RoadToOlympicsPage() {
  const t = await getTranslations('roadToOlympics')
  const tCountdown = await getTranslations('roadToOlympics.countdown')
  const tScore = await getTranslations('roadToOlympics.scorecard')

  const state = getState()
  const criteria = getCriteria()
  const dossier = getDecisionMakers()
  const daysUntil = computeDaysUntil(state.iocSessionAt)

  // Initial pledge count for SSR (refreshed client-side after mount)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
  const { count: pledgeCount } = await supabase
    .from('road_to_olympics_pledges')
    .select('*', { count: 'exact', head: true })

  // Map criteria rows to pill statuses + pill text from state counters
  const labelByKey: Record<string, string> = {
    compliance: tScore('complianceLabel'),
    continents: tScore('continentsLabel'),
    federations: tScore('federationsLabel'),
    gender: tScore('genderLabel'),
    elite: tScore('eliteLabel'),
  }
  const c = state.counters
  const scorecardRows = criteria.map((row) => {
    let pillStatus, pillText
    switch (row.key) {
      case 'compliance':
        pillStatus = derivePillStatus('compliance', c.compliance)
        pillText = pillStatus === 'done' ? '3/3' : tScore('pillBuilding')
        break
      case 'continents':
        pillStatus = derivePillStatus('continents', c.continentsCount)
        pillText = `${c.continentsCount}/3`
        break
      case 'federations':
        pillStatus = derivePillStatus('federations', c.federationsCount)
        pillText = `${c.federationsCount}`
        break
      case 'gender':
        pillStatus = derivePillStatus('gender', c.genderPctFemale)
        pillText = `${c.genderPctFemale}%`
        break
      case 'elite':
        pillStatus = derivePillStatus('elite', c.eliteCountriesCount)
        pillText = c.eliteStatusLabel
        break
      default:
        pillStatus = 'building' as const
        pillText = '—'
    }
    return { key: row.key, label: labelByKey[row.key]!, pillStatus, pillText }
  })

  const tweetIntentUrl = buildTweetIntentUrl({
    daysUntil,
    federations: c.federationsCount,
  })

  return (
    <>
      <GlobalHeader />
      <main style={{
        maxWidth: 600,
        margin: '0 auto',
        padding: '20px 16px 40px',
        background: '#0a0a0a',
        minHeight: '100vh',
        color: '#fff',
      }}>
        <HubHero />
        <CountdownCard
          daysUntil={daysUntil}
          label={tCountdown('labelDefault')}
          unit={tCountdown('daysUnit')}
          override={state.countdownLabel}
        />
        <CriteriaScorecard rows={scorecardRows} />
        <BeatsFeed limit={6} />
        <DecisionMakersDossier cards={dossier} />

        <div style={{
          fontSize: 11, color: '#555', textTransform: 'uppercase',
          letterSpacing: 1.2, fontWeight: 700, margin: '18px 0 8px',
        }}>
          {t('actionsTitle')}
        </div>
        <ActionHub tweetIntentUrl={tweetIntentUrl} daysUntil={daysUntil} />
        <PledgeInline initialCount={pledgeCount ?? 0} />

        <DisclosureFooter />
      </main>
    </>
  )
}
