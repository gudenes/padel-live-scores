// apps/ops/src/app/api/internal/channel-region-rules/route.ts
//
// GET    ?channelId=  → rules for a channel + suggestion payload + "watch on"
// POST   add block(s) for a channel { channelId, countries[], note? }
// DELETE ?id=         → remove a block
//
// Auth: Auth.js session with isOperator flag.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import {
  computeBlockSuggestions,
  type RegionBlockObservation,
} from '@/lib/where-to-watch/region-blocks'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const channelId = request.nextUrl.searchParams.get('channelId')
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  const supabase = serviceClient()

  const [{ data: rules }, { data: chan }, { data: bcasts }] = await Promise.all([
    supabase.from('channel_region_rules')
      .select('id, country_iso2, effect, source, note, created_at')
      .eq('channel_id', channelId).eq('effect', 'block')
      .order('country_iso2'),
    supabase.from('youtube_channels')
      .select('observed_region_blocks, observed_at').eq('id', channelId).maybeSingle(),
    supabase.from('broadcasters')
      .select('country_iso2, name, is_free')
      .eq('channel_id', channelId).eq('active', true),
  ])

  const blockedCountries = (rules ?? []).map(r => r.country_iso2 as string)

  // "Viewers here watch on" — broadcasters per blocked country.
  const watchOn: Record<string, string[]> = {}
  const broadcasterCountries = new Set<string>()
  for (const b of bcasts ?? []) {
    const cc = (b.country_iso2 as string).toLowerCase()
    broadcasterCountries.add(cc)
    ;(watchOn[cc] ??= []).push(b.name as string)
  }

  const suggestions = computeBlockSuggestions({
    observed: (chan?.observed_region_blocks as RegionBlockObservation | null) ?? null,
    broadcasterCountries: [...broadcasterCountries],
    alreadyBlocked: blockedCountries,
  })

  return NextResponse.json({
    rules: rules ?? [],
    watchOn,
    suggestions,
    observedAt: chan?.observed_at ?? null,
  })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json()) as {
    channelId?: string; countries?: string[]; source?: string; note?: string
  }
  if (!body.channelId || !body.countries?.length) {
    return NextResponse.json({ error: 'channelId and countries required' }, { status: 400 })
  }
  const supabase = serviceClient()
  const rows = body.countries.map(cc => ({
    channel_id: body.channelId,
    country_iso2: cc.toLowerCase(),
    effect: 'block',
    source: body.source === 'manual' || body.source === 'yt_api' || body.source === 'broadcaster'
      ? body.source : 'manual',
    note: body.note ?? null,
  }))
  const { error } = await supabase
    .from('channel_region_rules')
    .upsert(rows, { onConflict: 'channel_id,country_iso2', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, added: rows.length })
}

export async function DELETE(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const supabase = serviceClient()
  const { error } = await supabase.from('channel_region_rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
