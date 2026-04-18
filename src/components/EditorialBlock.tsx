'use client'
// src/components/EditorialBlock.tsx
// Client-side editorial renderer. Rendered inside the tournament detail page's
// Overview tab (kind='preview') and Recap tab (kind='recap'), so the block
// lives inside its matching tab — exactly as the Option-A mockup specified.
//
// Why client-side: the tournament page is 'use client' and manages tab state
// via useState/URL params. Server-rendering the editorial outside that state
// would either land it in the wrong place (above all tabs) or require a big
// refactor. Client fetch keeps the tab integration simple; Google's renderer
// still picks up the text on JS-enabled crawls, and the text is also surfaced
// via /matches/[date] + sitemap-daily.xml, so SEO reach is preserved.

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#6B7280'
const BG_CARD = '#141414'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const CHUNKY_CALLOUT = 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)'

interface Props {
  tournamentId: string
  kind: 'preview' | 'recap'
}

interface Row {
  headline: string
  lead: string
  body_md: string
  callout_key: string | null
  callout_value: string | null
  word_count: number
  generated_at: string
}

export function EditorialBlock({ tournamentId, kind }: Props) {
  const locale = useLocale()
  const t = useTranslations('editorial')
  const [post, setPost] = useState<Row | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await supabase
          .from('editorial_posts')
          .select('headline, lead, body_md, callout_key, callout_value, word_count, generated_at')
          .eq('entity_type', 'tournament')
          .eq('entity_id', tournamentId)
          .eq('kind', kind)
          .eq('locale', locale)
          .maybeSingle()
        if (!cancelled) {
          setPost((data as Row | null) ?? null)
          setLoaded(true)
        }
      } catch {
        if (!cancelled) setLoaded(true)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [tournamentId, kind, locale])

  // Render nothing until we know whether a post exists — avoids layout flash
  if (!loaded) return null
  if (!post) return null

  const isRecap = kind === 'recap'
  const badgeText = isRecap ? t('badgeRecap') : t('badgePreview')
  const badgeColor = isRecap ? GREEN : ORANGE

  const paragraphs = post.body_md.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
  const generatedDate = new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric',
  }).format(new Date(post.generated_at))

  return (
    <section
      aria-label={badgeText}
      style={{
        padding: '14px 14px 16px',
        margin: '0 0 14px',
        background: 'linear-gradient(180deg, rgba(245,166,35,0.04) 0%, transparent 100%)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Badge + byline */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: badgeColor, color: '#0A0A0A',
          fontSize: 9, fontWeight: 900, padding: '4px 8px',
          clipPath: CHUNKY_BADGE,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          ◆ {badgeText}
        </span>
        <span style={{
          fontSize: 9, color: MUTED, fontWeight: 600,
          letterSpacing: 0.3, textTransform: 'uppercase',
        }}>
          {t('byline', { date: generatedDate })}
        </span>
      </div>

      {/* Headline */}
      <h2 style={{
        fontSize: 17, fontWeight: 900, margin: '0 0 10px',
        letterSpacing: -0.3, lineHeight: 1.25, color: '#FFFFFF',
      }}>
        {post.headline}
      </h2>

      {/* First paragraph (lead) */}
      {paragraphs.length > 0 && <p style={paragraphStyle}>{paragraphs[0]}</p>}

      {/* Callout */}
      {post.callout_key && post.callout_value && (
        <div style={{
          margin: '10px 0 12px',
          padding: '10px 12px',
          background: BG_CARD,
          borderLeft: `2px solid ${ORANGE}`,
          clipPath: CHUNKY_CALLOUT,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800, color: ORANGE,
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2,
          }}>
            {post.callout_key}
          </div>
          <div style={{
            fontSize: 13, fontWeight: 700, color: '#FFFFFF', lineHeight: 1.35,
          }}>
            {post.callout_value}
          </div>
        </div>
      )}

      {/* Remaining paragraphs */}
      {paragraphs.slice(1).map((p, i) => (
        <p key={i} style={paragraphStyle}>{p}</p>
      ))}

      {/* Foot */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: 8,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        fontSize: 10, color: MUTED, marginTop: 4,
      }}>
        <span>{t('footNote')}</span>
        <span>{t('wordCount', { count: post.word_count })}</span>
      </div>
    </section>
  )
}

const paragraphStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'rgba(255,255,255,0.82)',
  lineHeight: 1.55,
  margin: '0 0 10px',
}
