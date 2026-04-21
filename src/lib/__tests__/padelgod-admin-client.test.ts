import { describe, it, expect } from 'vitest'
import {
  triggerPadelgodWorker,
  triggerPadelgodWorkersSequential,
  type WorkerName,
} from '../padelgod-admin-client'

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => {
  status: number
  body: unknown
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const out = handler(input, init)
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      json: async () => out.body,
      text: async () => JSON.stringify(out.body),
    } as Response
  }) as typeof fetch
}

describe('triggerPadelgodWorker', () => {
  it('posts to /admin/run-worker with the bearer token and worker name', async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined
    const fetchFn = mockFetch((url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return { status: 200, body: { data: { worker: 'draw-fetcher', result: { inserted: 5 }, durationMs: 1200 } } }
    })

    const result = await triggerPadelgodWorker('draw-fetcher', {
      baseUrl: 'https://padelgod.example.com',
      adminToken: 'secret-123',
      fetchFn,
    })

    expect(capturedUrl).toBe('https://padelgod.example.com/admin/run-worker')
    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.headers).toMatchObject({
      'Authorization': 'Bearer secret-123',
      'Content-Type': 'application/json',
    })
    expect(capturedInit?.body).toBe(JSON.stringify({ worker: 'draw-fetcher' }))
    expect(result.ok).toBe(true)
    expect(result.worker).toBe('draw-fetcher')
    if (result.ok) {
      expect(result.durationMs).toBe(1200)
      expect(result.result).toEqual({ inserted: 5 })
    }
  })

  it('strips a trailing slash from baseUrl', async () => {
    let capturedUrl: string | undefined
    const fetchFn = mockFetch((url) => {
      capturedUrl = String(url)
      return { status: 200, body: { data: { worker: 'oop-fetcher', result: null, durationMs: 10 } } }
    })
    await triggerPadelgodWorker('oop-fetcher', {
      baseUrl: 'https://padelgod.example.com/',
      adminToken: 't',
      fetchFn,
    })
    expect(capturedUrl).toBe('https://padelgod.example.com/admin/run-worker')
  })

  it('returns ok=false when padelgod responds with a non-2xx and error body', async () => {
    const fetchFn = mockFetch(() => ({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Invalid or missing admin token' } },
    }))
    const result = await triggerPadelgodWorker('draw-fetcher', {
      baseUrl: 'https://p.example.com', adminToken: 'bad', fetchFn,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.error).toMatch(/Invalid or missing admin token/)
    }
  })

  it('returns ok=false when padelgod returns a 500 with a generic internal error', async () => {
    const fetchFn = mockFetch(() => ({
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'scrape_jobs insert failed: ECONNREFUSED' } },
    }))
    const result = await triggerPadelgodWorker('static-reconciler', {
      baseUrl: 'https://p.example.com', adminToken: 't', fetchFn,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/scrape_jobs insert failed/)
    }
  })

  it('catches network errors and returns ok=false', async () => {
    const fetchFn: typeof fetch = (async () => {
      throw new Error('fetch failed')
    }) as typeof fetch
    const result = await triggerPadelgodWorker('draw-fetcher', {
      baseUrl: 'https://p.example.com', adminToken: 't', fetchFn,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/fetch failed/)
    }
  })
})

describe('triggerPadelgodWorkersSequential', () => {
  it('runs workers in the given order and returns one result per worker', async () => {
    const calls: string[] = []
    const fetchFn = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { worker: string }
      calls.push(body.worker)
      return { status: 200, body: { data: { worker: body.worker, result: {}, durationMs: 10 } } }
    })
    const workers: WorkerName[] = ['draw-fetcher', 'oop-fetcher', 'results-fetcher', 'static-reconciler']
    const results = await triggerPadelgodWorkersSequential(workers, {
      baseUrl: 'https://p.example.com', adminToken: 't', fetchFn,
    })
    expect(calls).toEqual(workers)
    expect(results).toHaveLength(4)
    expect(results.every(r => r.ok)).toBe(true)
  })

  it('continues past a failed worker and records each outcome independently', async () => {
    // First call fails, others succeed. The orchestrator should not abort.
    let callIdx = 0
    const fetchFn = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { worker: string }
      callIdx++
      if (callIdx === 1) {
        return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'boom' } } }
      }
      return { status: 200, body: { data: { worker: body.worker, result: {}, durationMs: 5 } } }
    })
    const results = await triggerPadelgodWorkersSequential(
      ['draw-fetcher', 'oop-fetcher', 'results-fetcher'],
      { baseUrl: 'https://p.example.com', adminToken: 't', fetchFn }
    )
    expect(results[0].ok).toBe(false)
    expect(results[1].ok).toBe(true)
    expect(results[2].ok).toBe(true)
  })
})
