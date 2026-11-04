// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ pathname: '/home', decided: true, login: false, seen: false }))
vi.mock('next-intl', () => ({ useLocale: () => 'es' }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => state.pathname }))
vi.mock('@/hooks/useConsent', () => ({ useConsent: () => ({ hasDecided: state.decided }) }))
vi.mock('@/components/LoginSheetProvider', () => ({ useLoginSheet: () => ({ isOpen: state.login }) }))
vi.mock('./release-state', async importOriginal => ({ ...(await importOriginal<typeof import('./release-state')>()), hasSeenRelease: () => state.seen, markReleaseSeen: () => { state.seen = true } }))
vi.mock('./ReleasePopup', () => ({ default: function MockReleasePopup({ onShown, onClose, locale }: { onShown: () => void; onClose: () => void; locale: string }) {
  React.useEffect(onShown, [onShown])
  return <button onClick={onClose}>Release {locale}</button>
} }))
import ProductRelease from './ProductRelease'
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'))
  Object.assign(state, { pathname: '/home', decided: true, login: false, seen: false })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => { cleanup(); vi.useRealTimers() })
it('shows after a delay, records an impression, and remains dismissed after remount', () => {
  const view = render(<ProductRelease />)
  expect(screen.queryByText('Release es')).toBeNull()
  act(() => { vi.advanceTimersByTime(2500) })
  expect(screen.getByText('Release es')).toBeTruthy()
  expect(state.seen).toBe(true)
  act(() => screen.getByText('Release es').click())
  expect(screen.queryByText('Release es')).toBeNull()
  view.unmount(); render(<ProductRelease />)
  act(() => { vi.advanceTimersByTime(10000) })
  expect(screen.queryByText('Release es')).toBeNull()
})
it('waits for existing modal dialogs to clear', () => {
  const dialog = document.createElement('dialog'); dialog.setAttribute('open', ''); document.body.append(dialog)
  render(<ProductRelease />)
  act(() => { vi.advanceTimersByTime(5000) })
  expect(state.seen).toBe(false)
  dialog.remove()
  act(() => { vi.advanceTimersByTime(2500) })
  expect(state.seen).toBe(true)
})
it.each(['consent', 'login', 'route', 'hidden'])('does not interrupt %s', reason => {
  if (reason === 'consent') state.decided = false
  if (reason === 'login') state.login = true
  if (reason === 'route') state.pathname = '/welcome'
  if (reason === 'hidden') Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  render(<ProductRelease />)
  act(() => { vi.advanceTimersByTime(10000) })
  expect(state.seen).toBe(false)
  expect(screen.queryByText('Release es')).toBeNull()
})

it('ignores the mounted but aria-hidden match filter panel', () => {
  const panel = document.createElement('aside')
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-hidden', 'true')
  document.body.append(panel)
  render(<ProductRelease />)
  act(() => { vi.advanceTimersByTime(2500) })
  expect(state.seen).toBe(true)
  panel.remove()
})
