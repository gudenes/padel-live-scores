import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import proxy from '../proxy'

describe('beta campaign language routing', () => {
  it.each([
    ['/beta-demo', 'es', 'en'],
    ['/es/beta-demo', 'en', 'es'],
    ['/pt/beta-demo', 'es', 'pt'],
    ['/beta', 'pt', 'en'],
    ['/es/beta', 'en', 'es'],
  ])('honors %s with a saved %s preference', (path, saved, expected) => {
    const response = proxy(new NextRequest(`https://padelnachos.com${path}?utm_source=reddit`, {
      headers: { cookie: `NEXT_LOCALE=${saved}` },
    }))
    expect(response.status).toBe(200)
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe(expected)
    const rewrite = new URL(response.headers.get('x-middleware-rewrite') || `https://padelnachos.com${path}?utm_source=reddit`)
    expect(rewrite.pathname).toBe(`/${expected}${path.replace(/^\/(es|pt)/, '')}`)
    expect(rewrite.searchParams.get('utm_source')).toBe('reddit')
  })
  it('canonicalizes explicit English without adding a second locale', () => {
    const response = proxy(new NextRequest('https://padelnachos.com/en/beta-demo?utm_source=reddit', {
      headers: { cookie: 'NEXT_LOCALE=es' },
    }))
    expect(new URL(response.headers.get('location')!).pathname).toBe('/beta-demo')
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('en')
  })
  it('retains saved-language behavior outside campaign pages', () => {
    const response = proxy(new NextRequest('https://padelnachos.com/pt/matches', {
      headers: { cookie: 'NEXT_LOCALE=es' },
    }))
    expect(new URL(response.headers.get('location')!).pathname).toBe('/es/matches')
  })
})
