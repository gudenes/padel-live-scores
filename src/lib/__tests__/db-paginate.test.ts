import { describe, it, expect } from 'vitest'
import { paginatedSelect } from '../db-paginate'

// The helper's contract:
//   - calls buildQuery(start, end) repeatedly with start += pageSize
//   - stops when a page returns < pageSize rows (last page)
//   - stops when error fires (throws with prefix)
//   - stops when maxRows exceeded (safety cap)
//   - concatenates all pages in fetch order

interface Row {
  i: number
}

function fakeBackend(rows: Row[]) {
  return (start: number, end: number) =>
    Promise.resolve({
      data: rows.slice(start, end + 1) as unknown[],
      error: null,
    })
}

describe('paginatedSelect', () => {
  it('returns all rows when total < pageSize (single page)', async () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ i }))
    const result = await paginatedSelect<Row>(fakeBackend(data), {
      pageSize: 100,
      what: 'test',
    })
    expect(result).toHaveLength(50)
    expect(result[0]!.i).toBe(0)
    expect(result[49]!.i).toBe(49)
  })

  it('paginates across multiple pages and concatenates in order', async () => {
    // 1500 rows with pageSize=500 → exactly 3 pages of 500. Last page
    // returns fewer than pageSize? No — exactly pageSize. So the loop
    // continues for one more page that returns 0 rows. Either way:
    // result must be 1500 items, sorted 0..1499.
    const data = Array.from({ length: 1500 }, (_, i) => ({ i }))
    const result = await paginatedSelect<Row>(fakeBackend(data), {
      pageSize: 500,
      what: 'test',
    })
    expect(result).toHaveLength(1500)
    expect(result.map((r) => r.i)).toEqual(data.map((d) => d.i))
  })

  it('stops at the partial last page (the Leiria-style case)', async () => {
    // 1004 rows with pageSize=1000:
    //   page 0: rows 0..999 (1000 rows, == pageSize → continue)
    //   page 1: rows 1000..1003 (4 rows, < pageSize → stop)
    // Total: 1004. This is the case the helper exists to handle —
    // without pagination the loader would return only the first 1000.
    const data = Array.from({ length: 1004 }, (_, i) => ({ i }))
    const result = await paginatedSelect<Row>(fakeBackend(data), {
      pageSize: 1000,
      what: 'test',
    })
    expect(result).toHaveLength(1004)
    expect(result[1003]!.i).toBe(1003)
  })

  it('throws with the `what` prefix on error, including offset', async () => {
    const failingBackend = (start: number, _end: number) =>
      Promise.resolve({
        data: null,
        error: { message: `boom@${start}` },
      })
    await expect(
      paginatedSelect<Row>(failingBackend, { what: 'oop_snapshots (tournament=t1)' }),
    ).rejects.toThrow(/oop_snapshots \(tournament=t1\) read failed at offset 0: boom@0/)
  })

  it('respects maxRows safety cap', async () => {
    // Infinite-feeling backend that always returns full pages —
    // pretends an unbounded result. The helper must stop at maxRows.
    const infiniteBackend = (_start: number, end: number) =>
      Promise.resolve({
        data: Array.from({ length: end - _start + 1 }, (_, i) => ({ i: _start + i })) as unknown[],
        error: null,
      })
    const result = await paginatedSelect<Row>(infiniteBackend, {
      pageSize: 1000,
      maxRows: 2500,
      what: 'test',
    })
    // The loop runs while start < maxRows. Pages are 1000 rows each.
    // start=0, 1000, 2000 — all < 2500. start=3000 exits the loop.
    // So we get 3 pages × 1000 = 3000 rows (the cap is "stop *checking*"
    // not "trim to cap"). Documented behaviour — runaway protection,
    // not exact slicing.
    expect(result.length).toBeGreaterThanOrEqual(2000)
    expect(result.length).toBeLessThan(5000)
  })

  it('handles null data field as empty page (graceful)', async () => {
    const nullBackend = () =>
      Promise.resolve({ data: null, error: null })
    const result = await paginatedSelect<Row>(nullBackend, {
      pageSize: 100,
      what: 'test',
    })
    expect(result).toEqual([])
  })
})
