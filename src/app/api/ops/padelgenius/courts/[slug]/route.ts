// src/app/api/ops/padelgenius/courts/[slug]/route.ts
import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { checkOpsAuth } from '@/lib/ops-auth'
import type { CourtConfig } from '@/lib/padelgenius/types'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

interface Ctx {
  params: Promise<{ slug: string }>
}

export async function GET(_req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { slug } = await params
  const file = path.join(COURTS_DIR, slug, 'config.json')
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return NextResponse.json({ slug, config: JSON.parse(raw) })
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { slug } = await params
  const body = await req.json() as Partial<CourtConfig>
  const file = path.join(COURTS_DIR, slug, 'config.json')
  let existing: CourtConfig
  try {
    existing = JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const merged: CourtConfig = {
    ...existing,
    ...body,
    bounds: { ...existing.bounds, ...(body.bounds ?? {}) },
    zones: { ...existing.zones, ...(body.zones ?? {}) },
    visualSystem: { ...existing.visualSystem, ...(body.visualSystem ?? {}) },
    branding: { ...existing.branding, ...(body.branding ?? {}) },
  }
  await fs.writeFile(file, JSON.stringify(merged, null, 2) + '\n')
  return NextResponse.json({ slug, config: merged })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { slug } = await params
  const dir = path.join(COURTS_DIR, slug)
  try {
    // Don't allow deleting the active court
    const cfg = JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf-8')) as CourtConfig
    if (cfg.active) return NextResponse.json({ error: 'cannot delete active court — activate another first' }, { status: 400 })
    await fs.rm(dir, { recursive: true, force: true })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
}
