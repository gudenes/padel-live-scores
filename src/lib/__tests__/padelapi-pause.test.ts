// src/lib/__tests__/padelapi-pause.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { padelapiPausedResponse } from '../padelapi-pause'

describe('padelapiPausedResponse', () => {
  const originalEnv = process.env.PADELAPI_PAUSED

  beforeEach(() => {
    delete process.env.PADELAPI_PAUSED
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PADELAPI_PAUSED
    } else {
      process.env.PADELAPI_PAUSED = originalEnv
    }
  })

  it('returns null when PADELAPI_PAUSED is unset', () => {
    expect(padelapiPausedResponse('scores')).toBeNull()
  })

  it('returns null when PADELAPI_PAUSED is any value other than the literal string "true"', () => {
    // Defensive: we only honor the exact string. Anything else = active.
    process.env.PADELAPI_PAUSED = 'false'
    expect(padelapiPausedResponse('scores')).toBeNull()
    process.env.PADELAPI_PAUSED = '1'
    expect(padelapiPausedResponse('scores')).toBeNull()
    process.env.PADELAPI_PAUSED = 'TRUE'
    expect(padelapiPausedResponse('scores')).toBeNull()
    process.env.PADELAPI_PAUSED = ''
    expect(padelapiPausedResponse('scores')).toBeNull()
  })

  it('returns a 200 JSON response with paused=true when the flag is set', async () => {
    process.env.PADELAPI_PAUSED = 'true'
    const res = padelapiPausedResponse('scores')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const body = await res!.json()
    expect(body).toMatchObject({
      paused: true,
      reason: 'PADELAPI_PAUSED env var is set',
      cron: 'scores',
    })
    expect(typeof body.timestamp).toBe('string')
    // ISO-ish timestamp
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow()
  })

  it('includes the caller-supplied cron name in the body', async () => {
    process.env.PADELAPI_PAUSED = 'true'
    for (const name of ['scores', 'sync', 'premier-stats', 'premier-discovery']) {
      const res = padelapiPausedResponse(name)
      const body = await res!.json()
      expect(body.cron).toBe(name)
    }
  })
})
