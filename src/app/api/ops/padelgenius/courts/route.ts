// src/app/api/ops/padelgenius/courts/route.ts
import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { checkOpsAuth } from '@/lib/ops-auth'
import { loadAllCourts } from '@/lib/padelgenius/court-loader'
import type { CourtConfig } from '@/lib/padelgenius/types'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

export async function GET() {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const courts = await loadAllCourts()
  return NextResponse.json({ courts })
}

export async function POST(request: Request) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth

  const form = await request.formData()
  const file = form.get('court') as File | null
  const name = (form.get('name') as string | null) ?? 'Untitled court'
  if (!file) return NextResponse.json({ error: 'missing file' }, { status: 400 })

  const slug = slugify(name) || `court-${Date.now()}`
  const dir = path.join(COURTS_DIR, slug)
  await fs.mkdir(dir, { recursive: true })

  // Save PNG
  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(path.join(dir, 'court.png'), buf)

  // Auto-thumbnail 200x300
  await sharp(buf).resize(200, 300, { fit: 'cover', position: 'center' }).png().toFile(path.join(dir, 'thumb.png'))

  // Default config (not active — admin must explicitly activate)
  const config: CourtConfig = {
    name,
    active: false,
    imageUrl: `/padelgenius/courts/${slug}/court.png`,
    bounds: {
      backGlassY: 0.25, backServiceY: 0.32, netY: 0.52, nearServiceY: 0.85, nearGlassY: 0.98,
      farLeftX: 0.25, farRightX: 0.74, nearLeftX: 0.05, nearRightX: 0.96,
    },
    zones: { attackDepth: 7, transitionDepth: 17 },
    visualSystem: { playerBaseSize: 90, scaleCurveMin: 0.85, scaleCurveMax: 1.20, letterRadius: 12, progressBarTilt: -7 },
    branding: { backWall: null, sideGlassLeft: null, sideGlassRight: null, netBand: null, floorCenter: null },
  }
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n')

  return NextResponse.json({ slug, config })
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}
