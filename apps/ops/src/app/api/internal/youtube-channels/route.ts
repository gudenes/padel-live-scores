// apps/ops/src/app/api/internal/youtube-channels/route.ts
//
// GET    list all youtube_channels (active + inactive)
// POST   create a new channel from a handle/URL/ID; resolves channel_id
//        + uploads_playlist_id via the YouTube API.
//
// Auth: Auth.js session with isOperator flag.
// Ported from src/app/api/ops/youtube-channels/route.ts (Plan 3b-extra Task 3).

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { parseYoutubeChannelInput } from '@/lib/youtube-channel-input'

interface CreateBody {
  input: string            // handle / URL / channel ID
  name: string
  abbreviation: string
  colorHex: string
  displayOrder?: number
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const { data, error } = await supabase
    .from('youtube_channels')
    .select(`
      id, channel_id, uploads_playlist_id, name, abbreviation,
      color_hex, display_order, is_active, created_at, updated_at
    `)
    .order('display_order', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Decorate each channel with whether it's currently live.
  const STALE_MS = 30 * 60 * 1000
  const { data: liveRows } = await supabase
    .from('youtube_channel_live')
    .select('channel_id, video_id, title')
    .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
  const liveByChannel = new Map<string, Array<{ videoId: string; title: string }>>()
  for (const r of liveRows ?? []) {
    const list = liveByChannel.get(r.channel_id as string) ?? []
    list.push({ videoId: r.video_id as string, title: r.title as string })
    liveByChannel.set(r.channel_id as string, list)
  }

  const channels = (data ?? []).map(c => ({
    ...c,
    live: liveByChannel.get(c.id as string) ?? [],
  }))

  return NextResponse.json({ channels })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 })

  let body: CreateBody
  try { body = (await request.json()) as CreateBody }
  catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }) }

  const { input, name, abbreviation, colorHex, displayOrder } = body
  if (!input || !name || !abbreviation || !colorHex) {
    return NextResponse.json({ error: 'input, name, abbreviation, colorHex required' }, { status: 400 })
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
    return NextResponse.json({ error: 'colorHex must be a 6-digit hex like #FF0000' }, { status: 400 })
  }

  const parsed = parseYoutubeChannelInput(input)
  if (!parsed) return NextResponse.json({ error: 'could not parse channel input' }, { status: 400 })

  // Resolve channel ID via YouTube API if we have a handle.
  let channelId: string
  if (parsed.kind === 'id') {
    channelId = parsed.value
  } else {
    const params = new URLSearchParams({
      part: 'id',
      forHandle: parsed.value,
      key: apiKey,
    })
    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`)
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `YouTube API: ${res.status} ${text}` }, { status: 502 })
    }
    const json = (await res.json()) as { items?: Array<{ id: string }> }
    if (!json.items || json.items.length === 0) {
      return NextResponse.json({ error: `handle '@${parsed.value}' not found on YouTube` }, { status: 404 })
    }
    channelId = json.items[0]!.id
  }

  // Mechanical derivation: uploads playlist ID = 'UU' + channelId.slice(2).
  const uploadsPlaylistId = `UU${channelId.slice(2)}`

  const supabase = serviceClient()

  const { data, error } = await supabase
    .from('youtube_channels')
    .insert({
      channel_id: channelId,
      uploads_playlist_id: uploadsPlaylistId,
      name,
      abbreviation,
      color_hex: colorHex,
      display_order: displayOrder ?? 100,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'channel already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ channel: data })
}
