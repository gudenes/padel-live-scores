// src/components/road-to-olympics/BeatsFeed.tsx
//
// Server component — fetches Olympic-keyword articles via the lib helper
// and renders them as a single chronological feed. The previous
// Wins / Watchlist tab split was retired post-Soft-Launch — see the
// "drop watchlist" PR for rationale (low real volume + curation cost
// outweighed the editorial value).

import { createClient } from '@supabase/supabase-js'
import { fetchOlympicBeats } from '@/lib/road-to-olympics/beats'
import { getTranslations } from 'next-intl/server'
import { GREEN, BG_CARD, BORDER, MUTED, CHUNKY } from '@/components/home/shared-constants'

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
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      clipPath: CHUNKY.card,
      padding: 14,
      marginBottom: 12,
    }}>
      <div style={{
        fontSize: 11,
        letterSpacing: 1,
        textTransform: 'uppercase',
        fontWeight: 700,
        color: GREEN,
        paddingBottom: 6,
        marginBottom: 10,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        {t('sectionTitle')}
      </div>

      {beats.length === 0 ? (
        <div style={{ fontSize: 12, color: MUTED, padding: '8px 0' }}>
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
            borderTop: i === 0 ? 'none' : `1px dashed ${BORDER}`,
            color: '#ccc',
            textDecoration: 'none',
          }}
        >
          <span style={{ color: GREEN, fontWeight: 700, marginRight: 6 }}>
            {new Date(beat.published_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </span>
          <span>{beat.title}</span>
          <span style={{ color: MUTED, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: 6 }}>
            {beat.source_name}
          </span>
        </a>
      ))}
    </section>
  )
}
