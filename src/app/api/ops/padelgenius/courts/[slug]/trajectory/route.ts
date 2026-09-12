// src/app/api/ops/padelgenius/courts/[slug]/trajectory/route.ts
//
// Upload or remove a per-trajectory-style decoration asset. Writes to
// public/padelgenius/courts/<slug>/trajectories/<style>.<png|svg> and patches
// the court's config.json `trajectoryAssets[style]` slot. Mirrors the sponsor
// flow exactly — just a different folder and config key.
import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { checkOpsAuth } from '@/lib/ops-auth'
import type { CourtConfig, TrajectoryStyle } from '@/lib/padelgenius/types'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

const VALID_STYLES: ReadonlySet<TrajectoryStyle> = new Set([
  'flat', 'lob', 'bandeja', 'vibora', 'smash', 'chiquita', 'wall-bounce', 'cross',
])

interface Ctx {
  params: Promise<{ slug: string }>
}

export async function POST(req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { slug } = await params

  const form = await req.formData()
  const style = form.get('style') as string | null
  const file = form.get('asset') as File | null
  const scale = parseFloat((form.get('scale') as string | null) ?? '1.0')

  if (!style || !VALID_STYLES.has(style as TrajectoryStyle)) {
    return NextResponse.json({ error: 'invalid or missing style' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'missing asset' }, { status: 400 })

  const dir = path.join(COURTS_DIR, slug, 'trajectories')
  await fs.mkdir(dir, { recursive: true })
  const ext = file.name.toLowerCase().endsWith('.svg') ? 'svg' : 'png'
  const filename = `${style}.${ext}`
  await fs.writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()))

  // Patch config
  const configFile = path.join(COURTS_DIR, slug, 'config.json')
  const cfg = JSON.parse(await fs.readFile(configFile, 'utf-8')) as CourtConfig
  cfg.trajectoryAssets = {
    ...(cfg.trajectoryAssets ?? {}),
    [style]: {
      logoUrl: `/padelgenius/courts/${slug}/trajectories/${filename}`,
      scale,
    },
  }
  await fs.writeFile(configFile, JSON.stringify(cfg, null, 2) + '\n')

  return NextResponse.json({ style, ...cfg.trajectoryAssets[style as TrajectoryStyle] })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { slug } = await params
  const { style } = await req.json() as { style: TrajectoryStyle }

  const configFile = path.join(COURTS_DIR, slug, 'config.json')
  const cfg = JSON.parse(await fs.readFile(configFile, 'utf-8')) as CourtConfig
  if (cfg.trajectoryAssets) {
    const { [style]: _removed, ...rest } = cfg.trajectoryAssets
    cfg.trajectoryAssets = rest
  }
  await fs.writeFile(configFile, JSON.stringify(cfg, null, 2) + '\n')
  return NextResponse.json({ style, removed: true })
}
