// src/lib/padelgenius/court-loader.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CourtConfig } from './types'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

export interface LoadedCourt {
  slug: string
  config: CourtConfig
}

export async function loadAllCourts(): Promise<LoadedCourt[]> {
  const entries = await fs.readdir(COURTS_DIR, { withFileTypes: true })
  const results: LoadedCourt[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const configPath = path.join(COURTS_DIR, entry.name, 'config.json')
    try {
      const raw = await fs.readFile(configPath, 'utf-8')
      const config = JSON.parse(raw) as CourtConfig
      results.push({ slug: entry.name, config })
    } catch {
      // skip directories without a config
    }
  }
  return results
}

export async function loadActiveCourt(): Promise<LoadedCourt> {
  const all = await loadAllCourts()
  const active = all.find(c => c.config.active)
  if (!active) {
    if (all.length === 0) throw new Error('No courts found under public/padelgenius/courts/')
    // Fallback: first court becomes active
    return all[0]
  }
  return active
}
