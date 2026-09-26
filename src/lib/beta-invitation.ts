export const BETA_INVITATION_SEEN = 'pn_beta_invitation_2026_10_seen'
export const BETA_SIGNUP_COMPLETE = 'pn_beta_signup_2026_10_complete'
let seenInSession = false

export function hasSeenBetaInvitation() {
  if (seenInSession) return true
  try {
    return localStorage.getItem(BETA_INVITATION_SEEN) === '1'
      || localStorage.getItem(BETA_SIGNUP_COMPLETE) === '1'
  } catch { return false }
}

export function markBetaInvitationSeen() {
  seenInSession = true
  try { localStorage.setItem(BETA_INVITATION_SEEN, '1') } catch { /* session fallback */ }
}

export function markBetaSignupComplete() {
  markBetaInvitationSeen()
  try { localStorage.setItem(BETA_SIGNUP_COMPLETE, '1') } catch { /* session fallback */ }
}
