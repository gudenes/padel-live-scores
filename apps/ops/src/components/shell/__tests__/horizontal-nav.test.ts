// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { HorizontalNav } from '../HorizontalNav'
vi.mock('next/navigation', () => ({ usePathname: () => '/scouting' }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: {children: React.ReactNode}) => createElement('a', props, children) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('horizontal navigation interaction', () => {
 it('marks Matches active, closes tools on Escape and restores focus', () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ count: 0 }) })))
  render(createElement(HorizontalNav))
  expect(screen.getByRole('link', { name: 'Matches' }).getAttribute('aria-current')).toBe('page')
  const summary = screen.getByText('Workspace'), details = summary.closest('details')!
  details.open = true; fireEvent.keyDown(summary, { key: 'Escape' })
  expect(details.open).toBe(false); expect(document.activeElement).toBe(summary)
 })
 it('closes an open dropdown when clicking outside navigation', () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ count: 0 }) })))
  render(createElement(HorizontalNav)); const details = screen.getByText('Workspace').closest('details')!
  details.open = true; fireEvent.pointerDown(document.body); expect(details.open).toBe(false)
 })
})
