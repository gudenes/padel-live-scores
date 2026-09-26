// @vitest-environment jsdom
import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('localStorage', new JSDOM('', { url: 'https://padelnachos.com' }).window.localStorage)
  vi.resetModules()
})
describe('beta invitation persistence', () => {
  it('persists an actual impression across page loads', async () => {
    let invitation = await import('../beta-invitation')
    expect(invitation.hasSeenBetaInvitation()).toBe(false)
    invitation.markBetaInvitationSeen()
    vi.resetModules()
    invitation = await import('../beta-invitation')
    expect(invitation.hasSeenBetaInvitation()).toBe(true)
  })
  it('suppresses the invitation after signup', async () => {
    const invitation = await import('../beta-invitation')
    invitation.markBetaSignupComplete()
    expect(localStorage.getItem(invitation.BETA_SIGNUP_COMPLETE)).toBe('1')
    expect(invitation.hasSeenBetaInvitation()).toBe(true)
  })
  it('falls back to session memory when browser storage is unavailable', async () => {
    vi.spyOn(Object.getPrototypeOf(localStorage), 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const invitation = await import('../beta-invitation')
    expect(invitation.hasSeenBetaInvitation()).toBe(false)
    invitation.markBetaInvitationSeen()
    expect(invitation.hasSeenBetaInvitation()).toBe(true)
  })
})
