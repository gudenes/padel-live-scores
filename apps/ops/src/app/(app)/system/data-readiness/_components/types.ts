import type { Stage, Verdict, CellState, DimensionKey } from '@/lib/readiness'

export type { Stage, Verdict, CellState, DimensionKey }

export interface DimensionResult { key: DimensionKey; state: CellState; detail: string }
export interface ReadinessRow {
  id: string
  name: string
  level: string | null
  startsAt: string | null
  endsAt: string | null
  matchCount: number
  stage: Stage
  verdict: Verdict
  divergent: boolean
  dimensions: DimensionResult[]
}

export type ViewMode = 'list' | 'calendar'
export type GroupBy = 'tier' | 'stage' | 'verdict'
