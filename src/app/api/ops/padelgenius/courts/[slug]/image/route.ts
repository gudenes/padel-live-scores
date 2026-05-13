// src/app/api/ops/padelgenius/courts/[slug]/image/route.ts
//
// Replace the court PNG for an existing court. Overwrites court.png in place
// and regenerates thumb.png via sharp. The config.json's imageUrl stays the
// same (already pointing at the slug's court.png) so no migration is needed.
import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { checkOpsAuth } from '@/lib/ops-auth'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

interface Ctx {
  params: Promise<{ slug: string }>
}

export async function POST(req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { slug } = await params

  const dir = path.join(COURTS_DIR, slug)
  // Make sure the court folder actually exists
  try {
    await fs.access(path.join(dir, 'config.json'))
  } catch {
    return NextResponse.json({ error: 'court not found' }, { status: 404 })
  }

  const form = await req.formData()
  const file = form.get('court') as File | null
  if (!file) return NextResponse.json({ error: 'missing court file' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(path.join(dir, 'court.png'), buf)

  // Regenerate thumbnail
  await sharp(buf)
    .resize(200, 300, { fit: 'cover', position: 'center' })
    .png()
    .toFile(path.join(dir, 'thumb.png'))

  return NextResponse.json({ slug, replaced: true, bytes: buf.length })
}
