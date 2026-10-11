import { describe, it, expect } from 'vitest'
import { GROUPS, activeDestination, tournamentLinks, workspaceGroups } from '../navigation'
describe('horizontal admin navigation', () => {
 it('retains every sidebar destination including nested tools', () => {
  const previous = GROUPS.flatMap(g => g.items.flatMap(i => [i.href, ...(i.children?.map(c => c.href) ?? [])]))
  const current = ['/today', '/scouting', ...tournamentLinks.map(i => i.href), ...workspaceGroups.flatMap(g => g.items.flatMap(i => [i.href, ...(i.children?.map(c => c.href) ?? [])]))]
  expect(new Set(current)).toEqual(new Set(previous))
 })
 it('uses the most specific destination for reports and methodology', () => {
  expect(activeDestination('/scouting/123/report')).toBe('/scouting')
  expect(activeDestination('/scouting/methodology')).toBe('/scouting/methodology')
  expect(activeDestination('/odds/calibration')).toBe('/odds/calibration')
  expect(activeDestination('/system/coverage-matrix')).toBe('/system/coverage-matrix')
 })
})
