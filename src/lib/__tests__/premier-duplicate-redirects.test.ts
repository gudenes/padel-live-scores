import { describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import proxy from '../../proxy'

vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }))

const pairs = [
  ['3f3ac22c-20a0-4999-aaf2-d6451cefa65c', '8083ac24-da11-4a8f-84c5-708c21307e9f'],
  ['92b0a5cb-99a7-43f5-a24e-8d453a2759d6', 'c3fc9afd-adff-49ba-88bc-abaabc098732'],
  ['b62cb0c0-f777-405c-ad57-1490bf31755c', '29fbd066-1879-4f15-b9b6-8f9535a6b647'],
]

describe('duplicate tournament URLs', () => {
  it.each(pairs)('redirects %s before the alias page is loaded', (alias, preferred) => {
    for (const locale of ['', '/en', '/es', '/pt', '/it', '/fr']) {
      for (const slash of ['', '/']) {
        const response = proxy(new NextRequest(`https://padelnachos.com${locale}/tournaments/${alias}${slash}?tab=matches&category=women`))
        expect(response.status).toBe(307)
        expect(response.headers.get('location')).toBe(`https://padelnachos.com${locale}/tournaments/${preferred}${slash}?tab=matches&category=women`)
      }
    }
  })

  it.each(pairs)('does not redirect the preferred record into a loop', (_alias, preferred) => {
    const response = proxy(new NextRequest(`https://padelnachos.com/tournaments/${preferred}`))
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not rewrite APIs, unknown records, or other entity routes', () => {
    for (const path of ['/tournaments/new-id', `/players/${pairs[0][0]}`, `/tournaments/${pairs[0][0]}/other`]) {
      expect(proxy(new NextRequest(`https://padelnachos.com${path}`)).headers.get('location')).toBeNull()
    }
  })
})
