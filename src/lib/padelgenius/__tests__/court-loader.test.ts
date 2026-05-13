// src/lib/padelgenius/__tests__/court-loader.test.ts
import { describe, it, expect } from 'vitest'
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
})
