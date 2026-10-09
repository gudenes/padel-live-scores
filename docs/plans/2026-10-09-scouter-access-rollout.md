# Scouter access rollout

Implemented on codex/scouter-access from origin/main e2a712aa8. No production changes made.

## What ships
- Existing operators keep administrator privileges. Scouter is a separate, revocable grant.
- Team access at /team-access: grant an email, suspend/restore. Administrators cannot be modified here.
- Grants bind to a verified authenticated account, never an arbitrary client-supplied email. New users can use existing Google or magic-link sign-in. Google users whose emailVerified field is empty may need to sign out and back in after the grant.
- Scouter workspace /scouting: searchable, paginated canonical/private/legacy report library, filters for player/tournament, scouter, match date and completion.
- All scouters can read all saved reports and exports. Existing insights/set filters and calculation logic are reused unchanged.
- Scouters record through the extension; legacy on-site editor remains administrator-only.
- A new extension session is assigned to its first writer. Scouters write only their assigned sessions. Administrators may reassign from the library via Team access. Existing unassigned sessions remain administrator-editable until explicitly assigned.
- Required catalogue reads are scoped. Direct URLs and unexpected HTTP methods/server actions are denied for scouters. The existing isOperator flag is not widened.
- Role changes and attributed session writes are audited. Assignment enforcement runs in a database trigger as well as in the API.
- Match documents, stats and official scores are not rewritten by the migration.

## Deployment order (not performed)
1. Re-run scripts/session-check.sh. Merge reviewed code to main before admin deployment.
2. Back up production and apply supabase/migrations/20261009120000_scouter_access.sql using the established migration process.
3. Deploy admin from clean main, dry run first. Only do this when the owner requests deployment.
4. Verify the owner still signs in, opens admin tools and syncs an existing session.
5. Grant a test person's email in Team access. Use a fresh Chrome profile, sign in, install the existing extension and scout a private test match.
6. Verify all-match insights, exports, scoped navigation, own-session correction, other-session write refusal, suspend/re-enable and reassignment with pending local work.
7. No public web deployment is required. Existing extension protocol remains compatible; the changed extension account text is optional for functionality.

No emails or invitations are sent by granting access. The owner shares the sign-in/install instructions separately.

## Validation
- Permission policy, proxy restrictions, verified grant resolver, management API and existing scouting routes tested.
- Isolated PGlite database runs actual migration and triggers, checking canonical/private ownership, corrections, revocation, reassignment, immutable creator, audit and preserved documents.
  Run scripts/test-scouter-access-db.mjs with PGLITE_MODULE pointing to an isolated @electric-sql/pglite installation. This intentionally never uses DATABASE_URL.
- Existing 110 extension tests pass.
- TypeScript check passes.
- Full Next.js production build (webpack) passed with local build-only auth configuration. No production login test has been performed; fresh-profile provider validation remains a rollout check.

## Rollback and limits
Keep the additive tables and ownership fields; do not drop recorded data. Rollback to old application code removes scouter access because old code still requires operators. Old code can update administrator-owned legacy rows, but may be blocked on already attributed scouter rows by the assignment trigger; handle such corrections with the current admin application, not by disabling the trigger casually.
The migration does not infer old ownership from email. Library dates are match dates, last-save display uses Europe/Madrid. Legacy reports without a persisted finished phase are labeled “In progress / legacy”.
Independent simultaneous scout versions per match and an insights-only role are out of scope for this first release.
