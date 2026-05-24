import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { authMock, serviceClientMock, updateMock, eqMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  updateMock: vi.fn(),
  eqMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { POST } from '../route'

function buildSupabaseStub() {
  // .schema('padelgod').from('ocr_diff_events').update({...}).eq('id', n) → { error: null }
  eqMock.mockResolvedValue({ data: [{ id: 1 }], error: null })
  updateMock.mockReturnValue({ eq: eqMock })
  return {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    update: updateMock,
  }
}

beforeEach(() => {
  authMock.mockReset()
  serviceClientMock.mockReset()
  updateMock.mockReset()
  eqMock.mockReset()
})

describe('POST /api/internal/ocr-diff-label', () => {
  it('returns 401 when not operator', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: false } })
    const req = new NextRequest('http://localhost/api/internal/ocr-diff-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diffId: 42, label: 'correct' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('writes a "correct" label to notes', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    serviceClientMock.mockReturnValueOnce(buildSupabaseStub())

    const req = new NextRequest('http://localhost/api/internal/ocr-diff-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diffId: 42, label: 'correct' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: expect.stringContaining('operator_label=correct'),
      }),
    )
    // Notes string should contain the session's operator email
    const updateArg = updateMock.mock.calls[0][0]
    expect(updateArg.notes).toContain('by=op@x.com')
  })

  it('rejects unknown labels', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    const req = new NextRequest('http://localhost/api/internal/ocr-diff-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diffId: 42, label: 'maybe' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects missing diffId', async () => {
    authMock.mockResolvedValueOnce({ user: { isOperator: true, email: 'op@x.com' } })
    const req = new NextRequest('http://localhost/api/internal/ocr-diff-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'correct' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
