// src/components/road-to-olympics/BeatsFeed.tsx
//
// Server component — fetches Olympic-keyword articles via the lib helper.
// Renders the 'Wins' tab by default. The Watchlist split (negative-tone
// articles) lands in the Hardening Wave when articles.tone is populated;
// at Soft Launch we show all matches in 'Wins' and the Watchlist tab is
// disabled with an "Available soon" hint.

import { createClient } from '@supabase/supabase-js'
import { fetchOlympicBeats } from '@/lib/road-to-olympics/beats'
import { getTranslations } from 'next-intl/server'
import BeatsFeedTabs from './BeatsFeedTabs'

interface Props {
  /** Override fetch limit. Defaults to 6. */
  limit?: number
}

export default async function BeatsFeed({ limit = 6 }: Props) {
  const t = await getTranslations('roadToOlympics.beats')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
  const beats = await fetchOlympicBeats(supabase, limit)

  return (
    <section style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8,
      padding: 14,
      marginBottom: 12,
    }}>
      <BeatsFeedTabs winsLabel={t('tabWins')} watchlistLabel={t('tabWatchlist')} />

      {beats.length === 0 ? (
        <div style={{ fontSize: 12, color: '#888', padding: '8px 0' }}>
          {t('empty')}
        </div>
      ) : beats.map((beat, i) => (
        <a
          key={beat.id}
          href={beat.source_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            fontSize: 12,
            padding: '8px 0',
            borderTop: i === 0 ? 'none' : '1px dashed rgba(255,255,255,0.08)',
            color: '#ccc',
            textDecoration: 'none',
          }}
        >
          <span style={{ color: '#7ed321', fontWeight: 700, marginRight: 6 }}>
            {new Date(beat.published_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </span>
          <span>{beat.title}</span>
          <span style={{ color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: 6 }}>
            {beat.source_name}
          </span>
        </a>
      ))}
    </section>
  )
}
