import { expect, it } from 'vitest'
import { qualifyingPoints, type DrawRow } from './qualifying'
function draw(gender: string, counts: number[]): DrawRow[] {
  return counts.flatMap((count, n) => Array.from({ length: count }, (_, i) => ({ id: `${gender}-Q${n+1}-${i}`, round: `Q${n+1}`, round_canonical: `Q${n+1}`, category: gender })))
}
it('distinguishes Mexico men Q2 from the women qualifying final', () => {
  const points = qualifyingPoints('major', '2026', [...draw('men', [16,8,4]), ...draw('women', [8,4])])
  expect(points['men-Q1-0']).toMatchObject({ winner:15, loser:0 })
  expect(points['men-Q2-0']).toMatchObject({ winner:30, loser:15 })
  expect(points['men-Q3-0']).toMatchObject({ winner:50, loser:30, qualificationBonus:15 })
  expect(points['women-Q1-0']).toMatchObject({ winner:30, loser:0 })
  expect(points['women-Q2-0']).toMatchObject({ winner:50, loser:30, qualificationBonus:15 })
})
it('handles P1 eight qualifiers and distinct main-draw entry points', () => {
  expect(qualifyingPoints('p1','2026',draw('men',[16,8]))['men-Q2-0']).toMatchObject({winner:32,loser:18})
  expect(qualifyingPoints('p1','2026',draw('women',[8,4]))['women-Q2-0']).toMatchObject({winner:55,loser:18})
})
it('places 64-pair Silver qualifying points at Q3, not Q2', () => {
  const points=qualifyingPoints('fip_silver','2026',draw('men',[32,16,8,4]))
  expect(points['men-Q2-0']).toMatchObject({winner:2,loser:0})
  expect(points['men-Q3-0']).toMatchObject({winner:3,loser:2})
  expect(points['men-Q4-0']).toMatchObject({winner:6,loser:3,qualificationBonus:1})
})
it('supports 16-pair Bronze draws and zero-point rounds', () => {
  const points=qualifyingPoints('fip_bronze','2026',draw('women',[8,4]))
  expect(points['women-Q1-0']).toMatchObject({winner:2,loser:0})
  expect(points['women-Q2-0']).toMatchObject({winner:5,loser:2,qualificationBonus:0})
})
it('rejects incomplete, duplicated, unknown and future draws', () => {
  expect(qualifyingPoints('major','2026',draw('men',[16,8]))).toEqual({})
  expect(qualifyingPoints('major','2026',draw('men',[16,8,5]))).toEqual({})
  expect(qualifyingPoints('major','2027',draw('men',[16,8,4]))).toEqual({})
  expect(qualifyingPoints('unknown','2026',draw('men',[16,8,4]))).toEqual({})
})
