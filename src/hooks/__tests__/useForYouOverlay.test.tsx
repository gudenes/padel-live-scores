// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ForYouOverlayProvider, useForYouOverlay } from '../useForYouOverlay'

function wrapper({ children }: { children: React.ReactNode }) {
  return <ForYouOverlayProvider>{children}</ForYouOverlayProvider>
}

describe('useForYouOverlay', () => {
  it('initial state: closed, no articleId', () => {
    const { result } = renderHook(() => useForYouOverlay(), { wrapper })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.articleId).toBeNull()
  })

  it('openForYou(id) flips to open with articleId', () => {
    const { result } = renderHook(() => useForYouOverlay(), { wrapper })
    act(() => result.current.openForYou('article-123'))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.articleId).toBe('article-123')
  })

  it('closeForYou() flips back', () => {
    const { result } = renderHook(() => useForYouOverlay(), { wrapper })
    act(() => result.current.openForYou('article-123'))
    act(() => result.current.closeForYou())
    expect(result.current.isOpen).toBe(false)
  })

  it('consecutive openForYou calls swap the articleId without unmount', () => {
    const { result } = renderHook(() => useForYouOverlay(), { wrapper })
    act(() => result.current.openForYou('a'))
    expect(result.current.articleId).toBe('a')
    act(() => result.current.openForYou('b'))
    expect(result.current.articleId).toBe('b')
    expect(result.current.isOpen).toBe(true)
  })

  it('throws when used outside the provider', () => {
    const orig = console.error
    console.error = () => {}
    expect(() => renderHook(() => useForYouOverlay())).toThrow(/ForYouOverlayProvider/)
    console.error = orig
  })
})
