// Tests for the external-id-registry helper.
//
// Uses a minimal hand-rolled fake Supabase client that records the method
// chain used by each query. This keeps the tests fast and free of network
// dependencies while still exercising the real routing logic (hot columns
// vs sidecar) inside the helpers.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  findEntityBySourceId,
  registerSourceId,
  listSourceIds,
  hasHotColumn,
} from '../external-id-registry'

// ── Fake Supabase client ─────────────────────────────────────
// Records every invocation so assertions can inspect which table/column
// was queried. Returns pre-seeded responses indexed by a query signature.

type FakeResponse = { data: unknown; error: { message: string } | null }

interface FakeCall {
  table: string
  op: 'select' | 'update' | 'upsert'
  filters: Array<{ col: string; value: unknown }>
  selection?: string
  payload?: Record<string, unknown>
}

function createFakeSupabase() {
  const calls: FakeCall[] = []
  const responses: Record<string, FakeResponse> = {}

  function respondTo(signature: string, response: FakeResponse) {
    responses[signature] = response
  }

  function signatureFor(call: FakeCall): string {
    const filterStr = call.filters
      .map(f => `${f.col}=${JSON.stringify(f.value)}`)
      .sort()
      .join('&')
    return `${call.table}:${call.op}:${filterStr}`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeBuilder(call: FakeCall): any {
    const builder = {
      select(cols?: string) {
        call.selection = cols
        return builder
      },
      eq(col: string, value: unknown) {
        call.filters.push({ col, value })
        return builder
      },
      async maybeSingle() {
        calls.push(call)
        const sig = signatureFor(call)
        return responses[sig] ?? { data: null, error: null }
      },
      async single() {
        calls.push(call)
        const sig = signatureFor(call)
        return responses[sig] ?? { data: null, error: null }
      },
      then(resolve: (value: FakeResponse) => unknown) {
        // For unawaited terminal .eq chains (update/upsert path)
        calls.push(call)
        const sig = signatureFor(call)
        return resolve(responses[sig] ?? { data: null, error: null })
      },
    }
    return builder
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      return {
        select(cols?: string) {
          const call: FakeCall = { table, op: 'select', filters: [] }
          call.selection = cols
          return makeBuilder(call)
        },
        update(payload: Record<string, unknown>) {
          const call: FakeCall = { table, op: 'update', filters: [], payload }
          return makeBuilder(call)
        },
        upsert(payload: Record<string, unknown>) {
          const call: FakeCall = { table, op: 'upsert', filters: [], payload }
          // Upsert on Supabase resolves as a promise
          calls.push(call)
          const sig = signatureFor(call)
          return Promise.resolve(responses[sig] ?? { data: null, error: null })
        },
      }
    },
  }

  return { client, calls, respondTo, signatureFor }
}

// ── hasHotColumn ─────────────────────────────────────────────

describe('hasHotColumn', () => {
  it('returns true for known hot pairs', () => {
    expect(hasHotColumn('player', 'padelapi')).toBe(true)
    expect(hasHotColumn('player', 'fip')).toBe(true)
    expect(hasHotColumn('tournament', 'padelapi')).toBe(true)
    expect(hasHotColumn('tournament', 'fip')).toBe(true)
    expect(hasHotColumn('match', 'padelapi')).toBe(true)
  })

  it('returns false for pairs without a hot column', () => {
    expect(hasHotColumn('match', 'fip')).toBe(false)
    expect(hasHotColumn('season', 'padelapi')).toBe(false)
    expect(hasHotColumn('player', 'atp')).toBe(false)
    expect(hasHotColumn('tournament', 'whoscored')).toBe(false)
  })
})

// ── findEntityBySourceId ─────────────────────────────────────

describe('findEntityBySourceId', () => {
  let fake: ReturnType<typeof createFakeSupabase>

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('queries the hot column for player/padelapi', async () => {
    fake.respondTo(
      'players:select:padelapi_id="432"',
      { data: { id: 'player-uuid-1' }, error: null }
    )
    const id = await findEntityBySourceId(fake.client, 'player', 'padelapi', '432')
    expect(id).toBe('player-uuid-1')
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].table).toBe('players')
    expect(fake.calls[0].filters).toEqual([{ col: 'padelapi_id', value: '432' }])
  })

  it('queries the hot column for player/fip', async () => {
    fake.respondTo(
      'players:select:fip_id="fip-P200038"',
      { data: { id: 'player-uuid-2' }, error: null }
    )
    const id = await findEntityBySourceId(fake.client, 'player', 'fip', 'fip-P200038')
    expect(id).toBe('player-uuid-2')
    expect(fake.calls[0].filters).toEqual([{ col: 'fip_id', value: 'fip-P200038' }])
  })

  it('queries the hot column for tournament/padelapi', async () => {
    fake.respondTo(
      'tournaments:select:padelapi_id="778"',
      { data: { id: 't-uuid-1' }, error: null }
    )
    const id = await findEntityBySourceId(fake.client, 'tournament', 'padelapi', '778')
    expect(id).toBe('t-uuid-1')
    expect(fake.calls[0].table).toBe('tournaments')
  })

  it('queries the hot column for match/padelapi', async () => {
    fake.respondTo(
      'matches:select:padelapi_id="9999"',
      { data: { id: 'm-uuid-1' }, error: null }
    )
    const id = await findEntityBySourceId(fake.client, 'match', 'padelapi', '9999')
    expect(id).toBe('m-uuid-1')
    expect(fake.calls[0].table).toBe('matches')
  })

  it('falls back to the sidecar when the hot column misses', async () => {
    // Hot column lookup returns nothing
    fake.respondTo(
      'players:select:padelapi_id="not-in-hot"',
      { data: null, error: null }
    )
    // Sidecar has it
    fake.respondTo(
      'entity_external_ids:select:entity_type="player"&external_id="not-in-hot"&source="padelapi"',
      { data: { entity_id: 'player-uuid-sidecar' }, error: null }
    )
    const id = await findEntityBySourceId(fake.client, 'player', 'padelapi', 'not-in-hot')
    expect(id).toBe('player-uuid-sidecar')
    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[0].table).toBe('players')
    expect(fake.calls[1].table).toBe('entity_external_ids')
  })

  it('queries the sidecar directly for unknown sources', async () => {
    fake.respondTo(
      'entity_external_ids:select:entity_type="player"&external_id="abc-123"&source="atp"',
      { data: { entity_id: 'player-uuid-atp' }, error: null }
    )
    const id = await findEntityBySourceId(fake.client, 'player', 'atp', 'abc-123')
    expect(id).toBe('player-uuid-atp')
    // Should go straight to sidecar — no hot column probe
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].table).toBe('entity_external_ids')
  })

  it('returns null when neither hot nor sidecar has the ID', async () => {
    const id = await findEntityBySourceId(fake.client, 'match', 'whoscored', 'missing')
    expect(id).toBeNull()
  })

  it('returns null for empty externalId without hitting the DB', async () => {
    const id = await findEntityBySourceId(fake.client, 'player', 'padelapi', '')
    expect(id).toBeNull()
    expect(fake.calls).toHaveLength(0)
  })
})

// ── registerSourceId ─────────────────────────────────────────

describe('registerSourceId', () => {
  let fake: ReturnType<typeof createFakeSupabase>

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('writes to the hot column for padelapi/player', async () => {
    await registerSourceId(fake.client, {
      entityType: 'player',
      entityId: 'player-uuid-1',
      source: 'padelapi',
      externalId: '432',
    })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].table).toBe('players')
    expect(fake.calls[0].op).toBe('update')
    expect(fake.calls[0].payload).toEqual({ padelapi_id: '432' })
    expect(fake.calls[0].filters).toEqual([{ col: 'id', value: 'player-uuid-1' }])
  })

  it('writes to the hot column for fip/tournament', async () => {
    await registerSourceId(fake.client, {
      entityType: 'tournament',
      entityId: 't-uuid-1',
      source: 'fip',
      externalId: 'fip-gold-almaty-2026',
    })
    expect(fake.calls[0].table).toBe('tournaments')
    expect(fake.calls[0].payload).toEqual({ fip_id: 'fip-gold-almaty-2026' })
  })

  it('writes to the sidecar for new sources', async () => {
    await registerSourceId(fake.client, {
      entityType: 'player',
      entityId: 'player-uuid-1',
      source: 'atp',
      externalId: 'atp-12345',
    })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].table).toBe('entity_external_ids')
    expect(fake.calls[0].op).toBe('upsert')
    expect(fake.calls[0].payload).toMatchObject({
      entity_type: 'player',
      entity_id: 'player-uuid-1',
      source: 'atp',
      external_id: 'atp-12345',
    })
  })

  it('passes metadata through to the sidecar', async () => {
    await registerSourceId(fake.client, {
      entityType: 'tournament',
      entityId: 't-uuid-1',
      source: 'matchscorer',
      externalId: 'FIP-2026-1001',
      metadata: { url: 'https://example.com/event' },
    })
    expect(fake.calls[0].payload).toMatchObject({
      metadata: { url: 'https://example.com/event' },
    })
  })

  it('throws when externalId is empty', async () => {
    await expect(
      registerSourceId(fake.client, {
        entityType: 'player',
        entityId: 'player-uuid-1',
        source: 'padelapi',
        externalId: '',
      })
    ).rejects.toThrow('externalId is required')
  })
})

// ── listSourceIds ────────────────────────────────────────────

describe('listSourceIds', () => {
  let fake: ReturnType<typeof createFakeSupabase>

  beforeEach(() => {
    fake = createFakeSupabase()
  })

  it('combines hot columns and sidecar rows for a player', async () => {
    // Hot columns present on the row
    fake.respondTo(
      'players:select:id="player-uuid-1"',
      {
        data: { id: 'player-uuid-1', padelapi_id: '432', fip_id: 'fip-P200038' },
        error: null,
      }
    )
    // Sidecar has one extra source
    fake.respondTo(
      'entity_external_ids:select:entity_id="player-uuid-1"&entity_type="player"',
      {
        data: [{ source: 'atp', external_id: 'atp-9999', metadata: null }],
        error: null,
      }
    )

    const ids = await listSourceIds(fake.client, 'player', 'player-uuid-1')

    // Sort for deterministic comparison
    ids.sort((a, b) => a.source.localeCompare(b.source))

    expect(ids).toEqual([
      { source: 'atp',      externalId: 'atp-9999',     isHot: false, metadata: undefined },
      { source: 'fip',      externalId: 'fip-P200038',  isHot: true },
      { source: 'padelapi', externalId: '432',          isHot: true },
    ])
  })

  it('handles entities with only hot column IDs', async () => {
    fake.respondTo(
      'tournaments:select:id="t-uuid-1"',
      {
        data: { id: 't-uuid-1', padelapi_id: '778', fip_id: null },
        error: null,
      }
    )
    const ids = await listSourceIds(fake.client, 'tournament', 't-uuid-1')
    expect(ids).toEqual([
      { source: 'padelapi', externalId: '778', isHot: true },
    ])
  })
})
