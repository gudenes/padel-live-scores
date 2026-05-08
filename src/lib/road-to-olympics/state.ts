// src/lib/road-to-olympics/state.ts
//
// Helpers for the /road-to-olympics hub.
// During Soft Launch, state is read from src/data/road-to-olympics/state.json.
// In the Hardening Wave, this module switches to reading from the
// road_to_olympics_state Supabase table — callers don't change.

import stateJson from '@/data/road-to-olympics/state.json'
import criteriaJson from '@/data/road-to-olympics/criteria.json'
import decisionMakersJson from '@/data/road-to-olympics/decision-makers.json'
import type {
  CriteriaRow,
  CriteriaStatus,
  DecisionMaker,
  RoadToOlympicsState,
} from '@/types/road-to-olympics'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Whole days from `now` until `targetIso`, clamped to 0. Same-day or past
 * targets return 0; floor() keeps "almost a day away" honest at 0 rather
 * than rounding up.
 */
export function computeDaysUntil(
  targetIso: string,
  now: Date = new Date(),
): number {
  const target = new Date(targetIso).getTime()
  if (Number.isNaN(target)) return 0
  const delta = target - now.getTime()
  if (delta <= 0) return 0
  return Math.floor(delta / MS_PER_DAY)
}

type ComplianceShape = {
  charter: boolean
  wada: boolean
  manipulation: boolean
}

/**
 * Map a criteria key + value to one of three pill statuses. Used by the
 * <CriteriaScorecard /> component. Thresholds match the rationale in
 * src/data/road-to-olympics/criteria.json `derivation` fields.
 */
export function derivePillStatus(
  key: 'compliance',
  value: ComplianceShape,
): CriteriaStatus
export function derivePillStatus(
  key: 'continents' | 'federations' | 'gender' | 'elite',
  value: number,
): CriteriaStatus
export function derivePillStatus(
  key: string,
  value: number | ComplianceShape,
): CriteriaStatus {
  switch (key) {
    case 'compliance': {
      const c = value as ComplianceShape
      return c.charter && c.wada && c.manipulation ? 'done' : 'building'
    }
    case 'continents': {
      const n = value as number
      return n >= 3 ? 'done' : 'building'
    }
    case 'federations': {
      const n = value as number
      return n >= 100 ? 'done' : n >= 50 ? 'on-track' : 'building'
    }
    case 'gender': {
      const n = value as number
      return n >= 50 ? 'done' : n >= 35 ? 'on-track' : 'building'
    }
    case 'elite': {
      const n = value as number
      return n > 5 ? 'done' : n >= 3 ? 'on-track' : 'building'
    }
    default:
      return 'building'
  }
}

/** Read the current tracker state. Sync — JSON is bundled at build. */
export function getState(): RoadToOlympicsState {
  return stateJson as RoadToOlympicsState
}

/** Read the criteria rows. */
export function getCriteria(): CriteriaRow[] {
  return (criteriaJson as { rows: CriteriaRow[] }).rows
}

/** Read the decision-makers dossier. */
export function getDecisionMakers(): DecisionMaker[] {
  return (decisionMakersJson as { cards: DecisionMaker[] }).cards
}
