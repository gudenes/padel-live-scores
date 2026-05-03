// src/lib/delete-plan.ts
// Pure function: given a user id, return the ordered list of parameterized
// SQL statements that a DELETE /api/user/account transaction must execute.
//
// Design notes:
// - Step 1 (nulling referred_by on anyone this user invited) runs FIRST,
//   before any delete, so the self-referential FK on profiles.referred_by
//   does not block downstream deletes even if the cascade is weakened later.
// - Child-table deletes are explicit (not relying on ON DELETE CASCADE) so
//   the delete trail is auditable. Several of these tables have cascade
//   rules today; this plan still works if a future migration drops them.
// - Steps 9–11 delete the Auth.js-owned rows (sessions, accounts, users)
//   in an order that respects their FKs.
// - The avatar_url on profiles points at Google's CDN for all regular
//   users today — there is nothing to clean up in Supabase Storage.
//   If Phase 2 adds user avatar upload, extend this plan accordingly.

export interface DeleteStatement {
  sql: string
  params: [string]
}

export function buildDeletePlan(userId: string): DeleteStatement[] {
  return [
    // 1. Blank the inviter link on anyone this user referred (do not delete them).
    { sql: 'UPDATE profiles SET referred_by = NULL WHERE referred_by = $1', params: [userId] },

    // 2–10. Defensive explicit child deletes.
    { sql: 'DELETE FROM user_badges WHERE user_id = $1', params: [userId] },
    { sql: 'DELETE FROM user_bookmarks WHERE user_id = $1', params: [userId] },
    { sql: 'DELETE FROM push_subscriptions WHERE user_id = $1', params: [userId] },
    { sql: 'DELETE FROM native_push_subscriptions WHERE user_id = $1', params: [userId] },
    { sql: 'DELETE FROM user_notifications WHERE user_id = $1', params: [userId] },
    { sql: 'DELETE FROM match_ratings WHERE user_id = $1', params: [userId] },
    { sql: 'DELETE FROM feature_interest WHERE user_id = $1', params: [userId] },
    { sql: 'DELETE FROM user_activity_log WHERE user_id = $1', params: [userId] },
    { sql: 'DELETE FROM racket_clicks WHERE user_id = $1', params: [userId] },

    // 8. Profile row.
    { sql: 'DELETE FROM profiles WHERE id = $1', params: [userId] },

    // 9–10. Auth.js child rows. Column names are quoted because the
    // @auth/pg-adapter schema uses camelCase identifiers.
    { sql: 'DELETE FROM sessions WHERE "userId" = $1', params: [userId] },
    { sql: 'DELETE FROM accounts WHERE "userId" = $1', params: [userId] },

    // 11. Auth.js users row. Last — FK targets from sessions/accounts.
    { sql: 'DELETE FROM users WHERE id = $1', params: [userId] },
  ]
}
