// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BetaInvitation } from '../BetaInvitation'

const state = vi.hoisted(() => ({ path: '/home', decided: true, login: false, native: false, seen: false }))
vi.mock('next-intl', () => ({ useLocale: () => 'es' }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => state.native } }))
vi.mock('@/hooks/useConsent', () => ({ useConsent: () => ({ hasDecided: state.decided }) }))
vi.mock('@/components/LoginSheetProvider', () => ({ useLoginSheet: () => ({ isOpen: state.login }) }))
vi.mock('@/lib/beta-invitation', () => ({ hasSeenBetaInvitation: () => state.seen, markBetaInvitationSeen: () => { state.seen = true } }))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => state.path, Link: ({ children, locale, ...props }: React.ComponentProps<'a'> & { locale: string }) => <a {...props} href={`/${locale}${props.href}`}>{children}</a> }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => {
  Object.assign(state, { path: '/home', decided: true, login: false, native: false, seen: false })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-26T12:00:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers() })
const tick = () => act(() => { vi.advanceTimersByTime(2000) })

describe('beta invitation', () => {
  it('shows once, links to the localized signup and stays dismissed across visits', () => {
    const first = render(<BetaInvitation />)
    expect(document.querySelector('dialog')?.open).toBe(false)
    tick()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Quiero participar/ }).getAttribute('href')).toBe('/es/beta')
    expect(state.seen).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
    expect(document.querySelector('dialog')?.open).toBe(false)
    first.unmount()
    render(<BetaInvitation />)
    tick()
    expect(document.querySelector('dialog')?.open).toBe(false)
  })
  it('waits for a web consent decision', () => {
    state.decided = false
    const view = render(<BetaInvitation />)
    tick()
    expect(state.seen).toBe(false)
    state.decided = true
    view.rerender(<BetaInvitation />)
    tick()
    expect(document.querySelector('dialog')?.open).toBe(true)
  })
  it('does not require web cookie consent in the native app', () => {
    state.decided = false
    state.native = true
    render(<BetaInvitation />)
    tick()
    expect(document.querySelector('dialog')?.open).toBe(true)
  })
  it.each(['/beta', '/welcome', '/privacy', '/terms', '/support', '/delete-account'])('does not interrupt %s', path => {
    state.path = path
    render(<BetaInvitation />)
    tick()
    expect(state.seen).toBe(false)
  })
  it('waits until another modal closes', () => {
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    render(<BetaInvitation />)
    tick()
    expect(state.seen).toBe(false)
    modal.remove()
    tick()
    expect(state.seen).toBe(true)
  })
  it('does not appear after the signup deadline', () => {
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
    render(<BetaInvitation />)
    tick()
    expect(state.seen).toBe(false)
  })
  it('closes on navigation', () => {
    const view = render(<BetaInvitation />)
    tick()
    state.path = '/matches'
    view.rerender(<BetaInvitation />)
    expect(document.querySelector('dialog')?.open).toBe(false)
  })
})
