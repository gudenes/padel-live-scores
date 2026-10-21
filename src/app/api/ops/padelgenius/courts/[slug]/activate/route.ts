// src/app/api/ops/padelgenius/courts/[slug]/activate/route.ts
import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { checkOpsAuth } from '@/lib/ops-auth'
import { loadAllCourts } from '@/lib/padelgenius/court-loader'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

interface Ctx {
  params: Promise<{ slug: string }>
}

export async function POST(_req: Request, { params }: Ctx) {
  const unauth = await checkOpsAuth()
  if (unauth) return unauth
  const { slug } = await params

  const all = await loadAllCourts()
  const target = all.find(c => c.slug === slug)
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await Promise.all(all.map(c => {
    const file = path.join(COURTS_DIR, c.slug, 'config.json')
    const next = { ...c.config, active: c.slug === slug }
    return fs.writeFile(file, JSON.stringify(next, null, 2) + '\n')
  }))

  return NextResponse.json({ slug })
}
