import { promises as fs } from 'node:fs'
import path from 'node:path'
import { notFound } from 'next/navigation'
import { CourtEditor } from './CourtEditor'
import type { CourtConfig } from '@/lib/padelgenius/types'

export const dynamic = 'force-dynamic'

export default async function CourtEditorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const file = path.join(process.cwd(), 'public', 'padelgenius', 'courts', slug, 'config.json')
  let config: CourtConfig
  try { config = JSON.parse(await fs.readFile(file, 'utf-8')) } catch { return notFound() }
  return <CourtEditor slug={slug} initial={config} />
}
