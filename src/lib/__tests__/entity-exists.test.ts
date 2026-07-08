import { describe, it, expect } from 'vitest'
import { rowExistsById } from '../entity-exists'

// Build a fake supabase client whose query chain resolves to `result`.
// Chain used by the helper: from(table).select('id').eq('id', id).maybeSingle()
function fakeClient(result: { data: unknown; error: unknown } | Error) {
  const maybeSingle = () =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  const eq = () => ({ maybeSingle })
  const select = () => ({ eq })
  const from = () => ({ select })
  return { from } as unknown as Parameters<typeof rowExistsById>[0]
}

describe('rowExistsById', () => {
  it('returns true when a row is found', async () => {
    const client = fakeClient({ data: { id: 'abc' }, error: null })
    expect(await rowExistsById(client, 'tournaments', 'abc')).toBe(true)
  })

  it('returns false when no row exists (data null, no error)', async () => {
    const client = fakeClient({ data: null, error: null })
    expect(await rowExistsById(client, 'tournaments', 'missing')).toBe(false)
  })

  it('returns false for an invalid UUID (Postgres 22P02)', async () => {
    const client = fakeClient({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } })
    expect(await rowExistsById(client, 'tournaments', 'not-a-uuid')).toBe(false)
  })

  it('returns null (indeterminate) on a transport/connection error', async () => {
    const client = fakeClient({ data: null, error: { code: '08006', message: 'connection failure' } })
    expect(await rowExistsById(client, 'tournaments', 'abc')).toBe(null)
  })

  it('returns null (indeterminate) when the query throws', async () => {
    const client = fakeClient(new Error('network down'))
    expect(await rowExistsById(client, 'tournaments', 'abc')).toBe(null)
  })
})
