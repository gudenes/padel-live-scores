'use client'
import type { ReadinessRow, GroupBy } from './types'
export default function ReadinessList({ rows, groupBy }: { rows: ReadinessRow[]; groupBy: GroupBy }) {
  return <div data-stub>{`list stub: ${rows.length} rows, group=${groupBy}`}</div>
}
