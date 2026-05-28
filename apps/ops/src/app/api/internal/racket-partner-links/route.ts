// apps/ops/src/app/api/internal/racket-partner-links/route.ts
// Per-racket URL overrides for a given partner.
// GET ?partner_id=<uuid>: list overrides for that partner with racket info.
// POST: upsert (racket_id, partner_id) → url.
// DELETE ?id=<uuid>: remove one override row.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

interface LinkRow {
  id: string
  racket_id: string
  partner_id: string
  url: string
  racket_model: string
  racket_year: number | null
  brand_name: string | null
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const partnerId = new URL(request.url).searchParams.get('partner_id')
  if (!partnerId) {
    return NextResponse.json({ error: 'Missing partner_id' }, { status: 400 })
  }
  const { rows } = await pgPool().query<LinkRow>(
    `SELECT l.id, l.racket_id, l.partner_id, l.url,
            r.model AS racket_model, r.year AS racket_year,
            b.name AS brand_name
       FROM racket_partner_links l
       JOIN padel_rackets r ON r.id = l.racket_id
       LEFT JOIN padel_brands b ON b.id = r.brand_id
      WHERE l.partner_id = $1
      ORDER BY b.name NULLS LAST, r.model, r.year`,
    [partnerId],
  )
  return NextResponse.json({ links: rows })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    racket_id?: string
    partner_id?: string
    url?: string
  } | null
  if (!body?.racket_id || !body?.partner_id || !body?.url?.trim()) {
    return NextResponse.json(
      { error: 'Missing required field: racket_id, partner_id, url' },
      { status: 400 },
    )
  }
  try {
    const { rows } = await pgPool().query(
      `INSERT INTO racket_partner_links (racket_id, partner_id, url)
         VALUES ($1, $2, $3)
         ON CONFLICT (racket_id, partner_id)
         DO UPDATE SET url = EXCLUDED.url, updated_at = now()
         RETURNING id, racket_id, partner_id, url`,
      [body.racket_id, body.partner_id, body.url.trim()],
    )
    return NextResponse.json({ link: rows[0] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upsert failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }
  await pgPool().query(`DELETE FROM racket_partner_links WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
