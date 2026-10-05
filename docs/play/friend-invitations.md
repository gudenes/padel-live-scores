# Padel Predict invitations

Local review: `/es/invite-review`, then “Ver la pantalla de tu amigo”. Review links grant no access and the route is unavailable in production. Local `/invite-play` also uses review mode until invitations are configured.

Player entry points: Leaders → Invite friends, and the profile menu on Play → Invite friends. Existing general app referrals are retained elsewhere.

## Launch configuration (not enabled by this change)

- `PLAY_INVITES_ENABLED=true`
- `PLAY_INVITES_START_AT`: explicit ISO timestamp with time zone, agreed with Gustavo before deployment.
- Existing `AUTH_SECRET` signs tokens; never use a public key variable.

The window ends exactly 21 days after the configured start. This closes new invitation redemption; it does not revoke access from people who joined. It does not automatically open the game publicly afterward. That release is a separate decision.

Only current Play members can create invitations. Links are reusable, expire at the window end, and bind to the issuing origin. Local links do not work in production. Acceptance requires login, a valid signature, an active window, the Play master switch, a still-whitelisted inviter, and a same-origin JSON request. Access is inserted idempotently into existing `play_access`; the inviter is recorded in `granted_by`. Existing grants are not overwritten. Apply migration `20261005140000_play_invitation_connections.sql` before enabling invitations. No wallet rewards.

The link is retained in the Google/Apple/email callback URL. After acceptance, full navigation to Play refreshes server access and invokes the existing name/avatar/first-prediction onboarding. OAuth must be tested with a callback origin registered with the provider before launch.

Share supports the existing Capacitor native share plugin, web share, and clipboard fallback. The landing page defines an artwork Open Graph preview. Test actual messaging previews after deployment, where crawlers can fetch the asset.

## Validation

11 unit tests cover time-window boundaries, reusable tokens, signature tampering, environment isolation, disabled configuration, authentication, origin checks, revoked inviter access, master flag, idempotent grants, and database failures. No production accounts were granted access in development testing.

## Bottom drawer placement

Invite friends opens a bottom drawer over Play from Leaders or the Play profile menu. The direct invite route and local review use the same drawer. Recipients still receive a dedicated sign-in screen.

After a successful prediction, a separate, non-blocking request checks whether the account has exactly one all-time buy trade. The automatic drawer waits for the confirmation and onboarding success guide to close and avoids interrupting another trade or market details. It is marked seen in per-account device storage; subsequent predictions are ineligible through the server history check. Existing players are not prompted retroactively. Invitation availability still controls the production prompt. Local previews grant no access.

Dismiss with Not now, Escape, backdrop, or downward swipe. Manual entry remains available after dismissal. Three additional hook tests cover deferred opening, existing-player exclusion, and manual reopening.

## Mutual follows on first join

Acceptance now calls the service-role-only `play_accept_friend_invitation` function. It creates the new whitelist grant and both follow relationships in one transaction. Existing grants are unchanged, self-invitations are no-ops, and reopening a link does not re-follow after an unfollow. The receiving screen explains the default connection.

The transaction was verified using isolated temporary database tables: mutual follows, idempotency, preserving unfollows, self-invites, and rollback on a failed follow insert. Production migration application is part of the release.
