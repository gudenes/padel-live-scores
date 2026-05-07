import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the tool dispatcher — this test focuses on the loop, not SQL.
vi.mock('../../src/lib/ai/tools', async () => {
  const actual = await vi.importActual<any>('../../src/lib/ai/tools')
  return {
    ...actual,
    dispatchTool: vi.fn(),
  }
})

// Mock the Anthropic client.
const mockCreate = vi.fn()
vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<any>('../../src/lib/ai/client')
  return {
    ...actual,
    anthropicClient: () => ({ messages: { create: mockCreate } }),
  }
})

import { runChat } from '../../src/lib/ai/chat'
import { dispatchTool } from '../../src/lib/ai/tools'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runChat', () => {
  it('returns text answer when Haiku finishes without tool use', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Hello.' }],
      usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })

    const r = await runChat({ priorMessages: [], userMessage: 'Hi' })
    expect(r.answer).toBe('Hello.')
    expect(r.citations).toEqual([])
    expect(r.cost.input_tokens).toBe(10)
    expect(r.cost.output_tokens).toBe(2)
  })

  it('executes a tool and feeds the result back', async () => {
    ;(dispatchTool as any).mockResolvedValueOnce({ ok: true, data: [{ id: 'p1', name: 'Tapia' }] })

    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'search_player', input: { query: 'Tapia' } },
        ],
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Found Tapia.' }],
        usage: { input_tokens: 120, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 80 },
      })

    const r = await runChat({ priorMessages: [], userMessage: 'Who is Tapia?' })
    expect(r.answer).toBe('Found Tapia.')
    expect(dispatchTool).toHaveBeenCalledOnce()
    expect(mockCreate).toHaveBeenCalledTimes(2)
    // Token costs accumulate
    expect(r.cost.input_tokens).toBe(220)
    expect(r.cost.output_tokens).toBe(25)
    expect(r.cost.cache_read_tokens).toBe(80)
  })

  it('aborts after 8 tool loops', async () => {
    ;(dispatchTool as any).mockResolvedValue({ ok: true, data: [] })
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_x', name: 'search_player', input: { query: 'x' } }],
      usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })

    await expect(runChat({ priorMessages: [], userMessage: 'spin' })).rejects.toThrow(/tool loop limit/)
  })
})
