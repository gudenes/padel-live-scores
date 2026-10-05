# Match results with personal Guacas payouts

The existing `/api/push/notify` path remains unchanged for anonymous recipients,
non-Play users and users without a position in the match. For whitelisted players,
when `PLAY_RESULT_PUSH_ENABLED=true`, it queues one match-level notification.
The new Railway cron calls `/api/cron/play-result-push` every minute.

## Delivery

- The first result creates a queue entry with a 30-second minimum delay. The
  minute scheduler determines actual delivery time. Pending markets can hold the
  initial message for up to two minutes from queue creation. Then the confirmed
  match result goes out; later settlements wake the queue for a follow-up.
- An early set result waits for the match to finish. No speculative payout is used.
- Settlement notices wake the queue atomically. Participants need not bookmark
  the match to receive their result. Tournament-only markets are outside this
  match-level notification change.
- All reads use the current settlement revision. Refunds and correction deltas
  are described separately. Received Guacas are wallet credits, not net profit.
- Followed-player photo, circuit fallback, match URL and per-match tag reuse the
  existing helpers. Android data-only delivery, iOS image attachments and web
  notification rendering are unchanged.
- The production Play flag, whitelist, match-result push preference and mute
  setting are checked before delivery. No new preference category is introduced.
- Frozen payloads plus per-device receipts prevent ordinary retries from
  re-sending successful deliveries. Leases serialize workers. A crash between
  provider acceptance and receipt persistence can still repeat delivery; the
  existing per-match tag replaces the Android/web notification. This is not an
  exactly-once provider guarantee.
- No historical backfill. Results older than 24 hours are consumed silently.
  Native invalid tokens are removed; web failures are not treated as proof that
  a subscription has expired.

## Rollout (not performed)

1. Apply `20261005120000_play_result_push_queue.sql`. This adds queue infrastructure
   and a notice trigger; it does not edit wallets or backfill results.
2. Deploy the web code and updated Railway cron runner, following AGENTS.md.
3. Enable `PLAY_RESULT_PUSH_ENABLED=true` on the web service when the worker is
   available. With the switch absent, the existing match notification path runs.
4. Verify a whitelisted account on iPhone and Android: photo, grouped payout,
   notification tap into match details, delayed settlement and mute preference.
   Do not use real settlement changes merely to test notification delivery.

## Verification

- `npx vitest run src/lib/__tests__/play-result-push.test.ts src/lib/__tests__/play-result-push-copy.test.ts src/lib/__tests__/push-copy.test.ts`
- `node --test scripts/test-play-push-queue.mjs` uses isolated PGlite, not Supabase.
- TypeScript check passed. No actual phone push or shared-database migration was
  executed during implementation.
