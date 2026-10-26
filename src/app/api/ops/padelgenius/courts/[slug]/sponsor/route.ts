// src/app/api/ops/padelgenius/courts/[slug]/sponsor/route.ts
import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { checkOpsAuth } from '@/lib/ops-auth'
import type { CourtConfig, BrandingSlots } from '@/lib/padelgenius/types'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')
type Slot = keyof BrandingSlots

interface Ctx {
  params: Promise<{ slug: string }>
}

export async function POST(req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { slug } = await params

  const form = await req.formData()
  const slot = form.get('slot') as Slot | null
  const file = form.get('logo') as File | null
  const scale = parseFloat((form.get('scale') as string | null) ?? '1.0')
  if (!slot || !file) return NextResponse.json({ error: 'missing slot or logo' }, { status: 400 })

  const dir = path.join(COURTS_DIR, slug, 'sponsors')
  await fs.mkdir(dir, { recursive: true })
  const ext = file.name.endsWith('.svg') ? 'svg' : 'png'
  const filename = `${slot}.${ext}`
  await fs.writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()))

  // Update config
  const configFile = path.join(COURTS_DIR, slug, 'config.json')
  const cfg = JSON.parse(await fs.readFile(configFile, 'utf-8')) as CourtConfig
  cfg.branding[slot] = {
    logoUrl: `/padelgenius/courts/${slug}/sponsors/${filename}`,
    scale,
  }
  await fs.writeFile(configFile, JSON.stringify(cfg, null, 2) + '\n')

  return NextResponse.json({ slot, logoUrl: cfg.branding[slot]?.logoUrl, scale })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { slug } = await params
  const { slot } = await req.json() as { slot: Slot }
  const configFile = path.join(COURTS_DIR, slug, 'config.json')
  const cfg = JSON.parse(await fs.readFile(configFile, 'utf-8')) as CourtConfig
  cfg.branding[slot] = null
  await fs.writeFile(configFile, JSON.stringify(cfg, null, 2) + '\n')
  return NextResponse.json({ slot, removed: true })
}
