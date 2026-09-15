// src/lib/padelgenius/__tests__/court-loader.test.ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadAllCourts, loadActiveCourt } from '../court-loader'

describe('court loader', () => {
  it('loads at least one court from disk', async () => {
    const all = await loadAllCourts()
    expect(all.length).toBeGreaterThan(0)
  })

  it('club-deportivo is in the list', async () => {
    const all = await loadAllCourts()
    expect(all.find(c => c.slug === 'club-deportivo')).toBeDefined()
  })

  it('exactly one court is active', async () => {
    const all = await loadAllCourts()
    const active = all.filter(c => c.config.active)
    expect(active.length).toBe(1)
  })

  it('loadActiveCourt returns the active one', async () => {
    const active = await loadActiveCourt()
    expect(active.slug).toBe('club-deportivo')
    expect(active.config.active).toBe(true)
  })

  it('preserves branding through a write-read round-trip', async () => {
    const file = path.join(process.cwd(), 'public', 'padelgenius', 'courts', 'club-deportivo', 'config.json')
    const original = await fs.readFile(file, 'utf-8')
    try {
      const cfg = JSON.parse(original)
      cfg.branding.backWall = { logoUrl: '/test.png', scale: 1.1 }
      await fs.writeFile(file, JSON.stringify(cfg, null, 2) + '\n')
      const all = await loadAllCourts()
      const club = all.find(c => c.slug === 'club-deportivo')!
      expect(club.config.branding.backWall).toEqual({ logoUrl: '/test.png', scale: 1.1 })
    } finally {
      // Always restore even if assertion fails — keeps the repo clean
      await fs.writeFile(file, original)
    }
  })
})
