'use client'
import type { ReadinessRow } from './types'
export default function ReadinessCalendar({ rows }: { rows: ReadinessRow[] }) {
  return <div data-stub>{`calendar stub: ${rows.length} rows`}</div>
}
