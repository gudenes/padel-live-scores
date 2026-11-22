// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import MatchPointsBadge from './MatchPointsBadge'
afterEach(cleanup)
it('explains points without navigating the card, and closes on Escape or outside tap', () => {
  const navigate = vi.fn()
  render(<NextIntlClientProvider locale="en" messages={messages}><div onClick={navigate}><MatchPointsBadge points={300} loserPoints={180} /></div></NextIntlClientProvider>)
  const badge = screen.getByRole('button')
  fireEvent.click(badge)
  expect(screen.getByRole('dialog').textContent).toContain('300 pts')
  expect(screen.getByRole('dialog').textContent).toContain('180 pts')
  expect(navigate).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(badge)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('distinguishes a zero-point Q1 exit from points secured by advancing to Q2', () => {
  render(<NextIntlClientProvider locale="en" messages={messages}><MatchPointsBadge points={15} loserPoints={0} qualifying /></NextIntlClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: /15 pts/ }))
  expect(screen.getByRole('dialog').textContent).toContain('15 pts')
  expect(screen.getByRole('dialog').textContent).toContain('0 pts')
})

it('close and backdrop taps never activate the match card', () => {
 const navigate = vi.fn()
 render(<NextIntlClientProvider locale="en" messages={messages}><div onClick={navigate}><MatchPointsBadge points={15} loserPoints={0} qualifying /></div></NextIntlClientProvider>)
 const badge = screen.getByRole('button', { name: /15 pts/ })
 fireEvent.click(badge)
 fireEvent.click(screen.getByRole('button', { name: 'Close' }))
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(document.activeElement).toBe(badge)
 fireEvent.click(badge)
 fireEvent.pointerDown(screen.getByRole('dialog').parentElement!)
 expect(screen.getByRole('dialog')).toBeTruthy()
 fireEvent.click(screen.getByRole('dialog').parentElement!)
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(navigate).not.toHaveBeenCalled()
})
