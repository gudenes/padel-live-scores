// apps/ops/src/app/api/internal/team-image/route.ts
// Operator-gated: overlap two players' portraits into a transparent PNG.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { composeTeamOverlay } from '@/lib/team-overlay'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { playerAId?: string; playerBId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { playerAId, playerBId } = body
  if (!playerAId || !playerBId) return NextResponse.json({ error: 'missing_players' }, { status: 400 })
  if (playerAId === playerBId) return NextResponse.json({ error: 'same_player' }, { status: 400 })

  const supabase = serviceClient()
  const { data: players, error } = await supabase
    .from('players')
    .select('id, name, photo_url')
    .in('id', [playerAId, playerBId])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const a = players?.find((p) => p.id === playerAId)
  const b = players?.find((p) => p.id === playerBId)
  if (!a || !b) return NextResponse.json({ error: 'player_not_found' }, { status: 404 })

  const missing = [a, b].filter((p) => !p.photo_url).map((p) => p.name)
  if (missing.length) return NextResponse.json({ error: 'missing_photo', players: missing }, { status: 400 })

  let bufA: Buffer
  let bufB: Buffer
  try {
    const [ra, rb] = await Promise.all([fetch(a.photo_url as string), fetch(b.photo_url as string)])
    if (!ra.ok || !rb.ok) throw new Error('download failed')
    bufA = Buffer.from(await ra.arrayBuffer())
    bufB = Buffer.from(await rb.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'download_failed' }, { status: 502 })
  }

  const png = await composeTeamOverlay(bufA, bufB)
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  })
}
