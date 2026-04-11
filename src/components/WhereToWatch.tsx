'use client'
// src/components/WhereToWatch.tsx
//
// "Where to Watch" card for the tournament detail page Overview tab.
// Two sections:
//   1. Global editorial cards (e.g. "Free YouTube for early rounds, Red Bull
//      TV for finals") — sourced from broadcast_info table
//   2. Regional broadcaster list for the user's country — sourced from
//      broadcasters table, country resolved via useUserCountry()
//
// Hidden entirely if:
//   - The tournament is not Premier-tier (the data only covers Premier)
//   - Both sections are empty (e.g. user country has no broadcasters and
//     editorial cards haven't synced yet)
//
// Visual style: matches the chunky brand language used elsewhere on the
// tournament page (BG_CARD background, CHUNKY clip-paths, ORANGE accents
// for section labels).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserCountry } from '@/hooks/useUserCountry'
import { ORANGE, GREEN, MUTED, BG_CARD, BG_CARD2, BORDER, CHUNKY } from '@/lib/theme-colors'

const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}
function countryDisplayName(iso2: string | null): string {
  if (!iso2) return 'your region'
  return ISO2_TO_NAME[iso2.toLowerCase()] ?? iso2.toUpperCase()
}

// ── Types ───────────────────────────────────────────────────
interface BroadcastInfo {
  id: string
  title: string
  description: string | null
  url: string
  logo_url: string | null
  display_order: number
}

interface Broadcaster {
  id: string
  name: string
  url: string
  logo_url: string | null
  is_free: boolean
  display_order: number
  country_iso2: string
}

// ── Component ───────────────────────────────────────────────

export default function WhereToWatch() {
  const country = useUserCountry()
  const [info, setInfo] = useState<BroadcastInfo[]>([])
  const [regional, setRegional] = useState<Broadcaster[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [infoRes, regionalRes] = await Promise.all([
          supabase
            .from('broadcast_info')
            .select('id, title, description, url, logo_url, display_order')
            .eq('active', true)
            .order('display_order'),
          country
            ? supabase
                .from('broadcasters')
                .select('id, name, url, logo_url, is_free, display_order, country_iso2')
                .eq('active', true)
                .eq('country_iso2', country)
                .order('display_order')
                .order('is_free', { ascending: false })
            : Promise.resolve({ data: [] as Broadcaster[], error: null }),
        ])
        if (cancelled) return
        setInfo((infoRes.data ?? []) as BroadcastInfo[])
        setRegional((regionalRes.data ?? []) as Broadcaster[])
      } catch (e) {
        if (!cancelled) console.warn('[WhereToWatch] load error:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [country])

  if (loading) return null
  if (info.length === 0 && regional.length === 0) return null

  return (
    <div style={{
      background: BG_CARD,
      clipPath: CHUNKY.card,
      border: `1px solid ${BORDER}`,
      padding: '14px 16px',
      marginBottom: 16,
    }}>
      {/* Card title */}
      <div style={{
        fontSize: 9, color: ORANGE, fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
          <polyline points="17 2 12 7 7 2" />
        </svg>
        Where to Watch
      </div>

      {/* ── Global editorial cards ── */}
      {info.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: regional.length > 0 ? 14 : 0 }}>
          {info.map(item => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                background: BG_CARD2,
                clipPath: 'polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)',
                textDecoration: 'none', color: 'inherit',
              }}
            >
              {item.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.logo_url}
                  alt=""
                  style={{ width: 48, height: 28, objectFit: 'contain', flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                  {item.title}
                </div>
                {item.description && (
                  <div style={{
                    fontSize: 9, color: MUTED, marginTop: 3,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                  }}>
                    {item.description}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: 9, fontWeight: 800, color: GREEN,
                background: 'rgba(126,211,33,0.12)',
                padding: '3px 8px', clipPath: CHUNKY.badge,
                whiteSpace: 'nowrap',
              }}>
                FREE →
              </span>
            </a>
          ))}
        </div>
      )}

      {/* ── Regional broadcasters ── */}
      {regional.length > 0 && (
        <>
          <div style={{
            fontSize: 9, color: MUTED, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.8,
            marginBottom: 8, marginTop: info.length > 0 ? 0 : 4,
          }}>
            In {countryDisplayName(country)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {regional.map(b => (
              <a
                key={b.id}
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px',
                  background: BG_CARD2,
                  clipPath: 'polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)',
                  textDecoration: 'none', color: 'inherit',
                }}
              >
                {b.logo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.logo_url}
                    alt=""
                    style={{ width: 36, height: 22, objectFit: 'contain', flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#fff' }}>
                  {b.name}
                </div>
                {b.is_free && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, color: GREEN,
                    background: 'rgba(126,211,33,0.12)',
                    padding: '2px 6px', clipPath: CHUNKY.badge,
                  }}>
                    FREE
                  </span>
                )}
                <span style={{ fontSize: 14, color: MUTED, marginLeft: 2 }}>→</span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
