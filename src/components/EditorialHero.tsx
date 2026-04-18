// src/components/EditorialHero.tsx
// Option A — the "bold embedded hero" for tournament previews + recaps.
// Server component; renders HTML directly into the tournament detail page
// so Google crawls it on first request (no JS required).
//
// Hidden when no post exists (graceful degradation).

import { getTranslations } from 'next-intl/server'
import { createServerClient } from '@/lib/supabase'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#6B7280'
const BG_CARD = '#141414'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const CHUNKY_CALLOUT = 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)'

interface Props {
  tournamentId: string
  locale: string
}

interface Row {
  kind: 'preview' | 'recap'
  headline: string
  lead: string
  body_md: string
  callout_key: string | null
  callout_value: string | null
  word_count: number
  generated_at: string
}

export async function EditorialHero({ tournamentId, locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'editorial' })
  const post = await loadPost(tournamentId, locale)
  if (!post) return null

  const isRecap = post.kind === 'recap'
  const badgeText = isRecap ? t('badgeRecap') : t('badgePreview')
  const badgeColor = isRecap ? GREEN : ORANGE

  // Split the body into paragraphs. The body contains the lead, so we render
  // the body (not lead + body).
  const paragraphs = post.body_md.split(/\n\n+/).map(p => p.trim()).filter(Boolean)

  const generatedDate = new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric',
  }).format(new Date(post.generated_at))

  return (
    <section
      aria-label={badgeText}
      style={{
        padding: '16px',
        background: 'linear-gradient(180deg, rgba(245,166,35,0.04) 0%, transparent 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Badge + byline row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
      }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: badgeColor,
          color: '#0A0A0A',
          fontSize: 9,
          fontWeight: 900,
          padding: '4px 8px',
          clipPath: CHUNKY_BADGE,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          ◆ {badgeText}
        </span>
        <span style={{
          fontSize: 9,
          color: MUTED,
          fontWeight: 600,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
        }}>
          {t('byline', { date: generatedDate })}
        </span>
      </div>

      {/* Headline */}
      <h2 style={{
        fontSize: 17,
        fontWeight: 900,
        margin: '0 0 10px',
        letterSpacing: -0.3,
        lineHeight: 1.25,
        color: '#FFFFFF',
      }}>
        {post.headline}
      </h2>

      {/* Body — paragraphs. The first one IS the lead; subsequent paragraphs
          come after the optional callout for a natural rhythm. */}
      {paragraphs.length > 0 && (
        <p style={paragraphStyle}>{paragraphs[0]}</p>
      )}

      {post.callout_key && post.callout_value && (
        <div style={{
          margin: '10px 0 12px',
          padding: '10px 12px',
          background: BG_CARD,
          borderLeft: `2px solid ${ORANGE}`,
          clipPath: CHUNKY_CALLOUT,
        }}>
          <div style={{
            fontSize: 9,
            fontWeight: 800,
            color: ORANGE,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 2,
          }}>
            {post.callout_key}
          </div>
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#FFFFFF',
            lineHeight: 1.35,
          }}>
            {post.callout_value}
          </div>
        </div>
      )}

      {paragraphs.slice(1).map((p, i) => (
        <p key={i} style={paragraphStyle}>{p}</p>
      ))}

      {/* Foot — transparency about the post */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 8,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        fontSize: 10,
        color: MUTED,
        marginTop: 4,
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

async function loadPost(tournamentId: string, locale: string): Promise<Row | null> {
  try {
    const supabase = createServerClient()
    // Prefer the tournament's current-state post:
    //   if the tournament has already ended (recap exists), show recap
    //   otherwise show preview
    // We fetch both and pick the latest one by kind priority.
    const { data } = await supabase
      .from('editorial_posts')
      .select('kind, headline, lead, body_md, callout_key, callout_value, word_count, generated_at')
      .eq('entity_type', 'tournament')
      .eq('entity_id', tournamentId)
      .eq('locale', locale)
      .in('kind', ['preview', 'recap'])
      .order('generated_at', { ascending: false })

    if (!data || data.length === 0) return null

    // Prefer recap over preview if both exist (event has concluded)
    const recap = data.find((r) => (r as { kind: string }).kind === 'recap')
    const preview = data.find((r) => (r as { kind: string }).kind === 'preview')
    return (recap ?? preview ?? null) as Row | null
  } catch (err) {
    console.warn('[EditorialHero] failed to load post:', (err as Error).message)
    return null
  }
}
