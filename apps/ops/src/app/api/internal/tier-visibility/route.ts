// apps/ops/src/app/api/internal/tier-visibility/route.ts
// List every tournament tier with its /matches visibility + counts.
// Tier list = distinct tournaments.level (via tier_visibility_stats())
// unioned with tier_visibility rows, so a newly-invented level shows up
// without a migration. Unconfigured levels are shown by default.
// Auth: Auth.js session with isOperator flag.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

interface StatsRow { level: string; tournaments: number; matches_90d: number; live_now: number }
interface ConfigRow {
  level: string
  label: string
  show_on_matches: boolean
  sort_order: number | null
  updated_at: string
  updated_by: string | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const [statsRes, configRes] = await Promise.all([
    supabase.rpc('tier_visibility_stats'),
    supabase
      .from('tier_visibility')
      .select('level, label, show_on_matches, sort_order, updated_at, updated_by'),
  ])
  if (statsRes.error) return Response.json({ error: statsRes.error.message }, { status: 500 })
  if (configRes.error) return Response.json({ error: configRes.error.message }, { status: 500 })

  const stats = new Map(((statsRes.data ?? []) as StatsRow[]).map((s) => [s.level, s]))
  const config = new Map(((configRes.data ?? []) as ConfigRow[]).map((c) => [c.level, c]))
  const levels = new Set([...stats.keys(), ...config.keys()])

  const tiers = [...levels].map((level) => {
    const s = stats.get(level)
    const c = config.get(level)
    return {
      level,
      label: c?.label ?? level,
      configured: !!c,
      show_on_matches: c?.show_on_matches ?? true,
      sort_order: c?.sort_order ?? 999,
      updated_at: c?.updated_at ?? null,
      updated_by: c?.updated_by ?? null,
      tournaments: Number(s?.tournaments ?? 0),
      matches_90d: Number(s?.matches_90d ?? 0),
      live_now: Number(s?.live_now ?? 0),
    }
  })
  tiers.sort((a, b) => a.sort_order - b.sort_order || a.level.localeCompare(b.level))

  return Response.json({ tiers })
}
