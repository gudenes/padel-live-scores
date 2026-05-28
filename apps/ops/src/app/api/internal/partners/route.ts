// apps/ops/src/app/api/internal/partners/route.ts
// Country-keyed ecommerce partners (e.g. Toro Doro / BR).
// GET: list all. POST: create. PATCH: update by id.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'

interface PartnerRow {
  id: string
  name: string
  country_code: string
  fallback_url: string
  active: boolean
  created_at: string
  updated_at: string
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { rows } = await pgPool().query<PartnerRow>(
    `SELECT id, name, country_code, fallback_url, active, created_at, updated_at
       FROM partners
       ORDER BY country_code, name`,
  )
  return NextResponse.json({ partners: rows })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string
    country_code?: string
    fallback_url?: string
    active?: boolean
  } | null

  const name = body?.name?.trim()
  const country = body?.country_code?.trim().toUpperCase()
  const fallback = body?.fallback_url?.trim()
  if (!name || !country || !fallback) {
    return NextResponse.json(
      { error: 'Missing required field: name, country_code, fallback_url' },
      { status: 400 },
    )
  }

  try {
    const { rows } = await pgPool().query<PartnerRow>(
      `INSERT INTO partners (name, country_code, fallback_url, active)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, country_code, fallback_url, active, created_at, updated_at`,
      [name, country, fallback, body?.active ?? true],
    )
    return NextResponse.json({ partner: rows[0] }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'insert failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    id?: string
    name?: string
    country_code?: string
    fallback_url?: string
    active?: boolean
  } | null

  if (!body?.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const sets: string[] = ['updated_at = now()']
  const values: unknown[] = []
  let i = 1
  if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name.trim()) }
  if (body.country_code !== undefined) { sets.push(`country_code = $${i++}`); values.push(body.country_code.trim().toUpperCase()) }
  if (body.fallback_url !== undefined) { sets.push(`fallback_url = $${i++}`); values.push(body.fallback_url.trim()) }
  if (body.active !== undefined) { sets.push(`active = $${i++}`); values.push(body.active) }
  values.push(body.id)

  try {
    const { rows } = await pgPool().query<PartnerRow>(
      `UPDATE partners
         SET ${sets.join(', ')}
         WHERE id = $${i}
         RETURNING id, name, country_code, fallback_url, active, created_at, updated_at`,
      values,
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    return NextResponse.json({ partner: rows[0] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'update failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
