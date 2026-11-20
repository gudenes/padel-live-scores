import { describe, expect, it } from 'vitest'
import { isWarmingUp, type Match } from '@/types/match'
const fixture = (level: string, score = '0-0') => ({
  status: 'live', tournament: { level },
  sets: [{ is_current: true, games: [{ is_current: true, game_score: score, serving_pair: 1, points: null }] }],
}) as unknown as Match
describe('PPL live eligibility across home and tournament pages', () => {
  it.each(['0-0', '15-30', '40-40'])('does not call a confirmed current score %s warmup', score => {
    expect(isWarmingUp(fixture('ppl', score))).toBe(false)
  })
  it('retains explicit warmup and missing-score behavior', () => {
    expect(isWarmingUp({ ...fixture('ppl'), status: 'on_court' } as unknown as Match)).toBe(true)
    expect(isWarmingUp(fixture('ppl', ''))).toBe(true)
  })
  it.each(['p1', 'fip_platinum', 'fip_gold'])('does not alter %s warmup detection', level => {
    expect(isWarmingUp(fixture(level))).toBe(true)
  })
})
