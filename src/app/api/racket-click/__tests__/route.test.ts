import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'

// Mimics postgrest-js: a query only executes when it is awaited (then() called).
const { executed, lazy } = vi.hoisted(() => {
  const executed: string[] = []
  const lazy = (label: string, result: unknown) => ({
    then: (resolve: (v: unknown) => unknown) => {
      executed.push(label)
      return Promise.resolve(result).then(resolve)
    },
  })
  return { executed, lazy }
})

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/racket-partner-resolver', () => ({
  getActivePartnerForCountry: async () => null,
  getPerRacketUrl: async () => null,
  resolveRacketDestination: ({ originalProductUrl }: { originalProductUrl: string }) => ({
    url: originalProductUrl,
    partnerId: null,
  }),
}))
vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'racket_clicks') {
        return { insert: (row: unknown) => lazy(`insert:${JSON.stringify(row)}`, { error: null }) }
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { id: 'r1', product_url: 'https://shop.example/r1', click_count: 4 },
              error: null,
            }),
          }),
        }),
        update: (patch: { click_count: number }) => ({
          eq: () => lazy(`update:${patch.click_count}`, { error: null }),
        }),
      }
    },
  }),
}))

function click(body: unknown) {
  return POST(
    new NextRequest('https://padelnachos.com/api/racket-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: 'geo-country=BR' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  executed.length = 0
})

describe('POST /api/racket-click', () => {
  it('records the click and bumps click_count before responding', async () => {
    const res = await click({ racket_id: 'r1', player_id: 'p1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://shop.example/r1' })
    expect(executed).toContain('update:5')
    const insert = executed.find((e) => e.startsWith('insert:'))
    expect(insert && JSON.parse(insert.slice('insert:'.length))).toEqual({
      racket_id: 'r1',
      player_id: 'p1',
      user_id: null,
      country_code: 'BR',
      partner_id: null,
      resolved_url: 'https://shop.example/r1',
    })
  })

  it('rejects a missing racket_id without writing', async () => {
    expect((await click({})).status).toBe(400)
    expect(executed).toEqual([])
  })
})
