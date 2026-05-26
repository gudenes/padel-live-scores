import { z } from 'zod';

/**
 * Boolean env-var parser. Replaces `z.coerce.boolean()`, which is broken
 * for strings — `Boolean("false")` is `true` because every non-empty
 * string is truthy in JS. That meant any default-true flag in this file
 * could be enabled via Railway but **never disabled**: setting
 * `FOO_DRY_RUN=false` parsed back to `true`, same as the default.
 *
 * Discovered 2026-04-25 when `FIP_DRAW_POPULATOR_DRY_RUN=false` had no
 * effect — the populator stayed in dry-run for every cron after the
 * env flip. This helper recognises the common opt-out spellings
 * explicitly. Unknown values fall back to the supplied default rather
 * than silently flipping behaviour on a typo.
 */
function boolEnv(defaultValue: boolean) {
  return z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (v === undefined || v === null) return defaultValue;
    if (typeof v !== 'string') return defaultValue;
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '') return false;
    return defaultValue;
  }, z.boolean());
}

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  PADELGOD_ADMIN_TOKEN: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ENABLE_SCHEDULER: boolEnv(true),
  ENABLE_TOURNAMENT_DISCOVERY: boolEnv(true),
  // fip-event-page-enricher — enriches FIP tournament rows with data scraped
  // from the padelfip.com event page (prize, draws, OOP). Runs at :12 each
  // hour, right after tournament-discovery (:00). Defaults ON so it starts
  // running on the next Railway deploy without manual env-var changes.
  ENABLE_FIP_EVENT_PAGE_ENRICHER: boolEnv(true),
  ENABLE_WIDGET_CODE_LOOKUP: boolEnv(true),
  ENABLE_PLAYER_RANKINGS: boolEnv(true),
  ENABLE_PLAYER_PROFILE: boolEnv(true),
  ENABLE_ENTRY_LIST_FETCHER: boolEnv(true),
  ENABLE_DRAW_FETCHER: boolEnv(true),
  // FIP event-page draw fetcher (PR 1 of the draw-linker pipeline). Source =
  // `fip_event_page`; writes to padelgod.draw_snapshots with match_widget_id
  // populated. Default OFF while we verify data quality on Brussels; flip
  // per-deploy via Railway env once confident. No writes to public.matches yet.
  ENABLE_FIP_DRAW_FETCHER: boolEnv(false),
  // fip-draw-populator — simplified-pipeline writer #1. Reads
  // padelgod.draw_snapshots (source='fip_event_page') and creates/updates
  // public.matches keyed by widget_id_composite. Intentionally parallel to
  // the legacy static-reconciler — see
  // docs/superpowers/specs/2026-04-24-simplified-pipeline-architecture.md.
  // Defaults OFF + DRY-RUN so enabling it in Railway is a two-step commit.
  ENABLE_FIP_DRAW_POPULATOR: boolEnv(false),
  FIP_DRAW_POPULATOR_DRY_RUN: boolEnv(true),
  // Per-tournament allowlist for the populator. Comma-separated
  // tournament UUIDs. When set, the populator processes ONLY those
  // tournaments — everything else is skipped.
  //
  // Migration use case (2026-04-24): Brussels P2 has 100+ legacy
  // public.matches rows that live-poller is actively updating with
  // live scores. Enabling populator writes globally would create
  // duplicate rows visible in tournament UI. Scope to clean-slate
  // tournaments first; bring Brussels across only when we're ready
  // to clean its legacy rows.
  //
  // Empty string / unset → no filter (process all eligible
  // tournaments, original behavior).
  FIP_DRAW_POPULATOR_ONLY_TOURNAMENTS: z.string().default(''),
  // Per-level denylist for the populator. Comma-separated
  // `tournaments.level` values to skip. Complementary to
  // FIP_DRAW_POPULATOR_ONLY_TOURNAMENTS — both filters compose
  // (allowlist applied first, then exclude-level on the survivors).
  //
  // Migration use case (2026-04-25): once Isla soak passes the user
  // wants to flip the populator to "all FIP tournaments except
  // Premier-tier" so every Bronze/Silver/Gold lands on the new
  // pipeline while Premier (Brussels, Paris, etc.) stays on the
  // legacy live-poller path. Premier-tier levels in this codebase:
  //   - Current era: p1, p2, major, finals
  //   - WPT era (legacy): wpt_1000, wpt_500, wpt_master, wpt_final
  //
  // Recommended Railway value for the soak phase:
  //   FIP_DRAW_POPULATOR_EXCLUDE_LEVELS=p1,p2,major,finals,wpt_1000,wpt_500,wpt_master,wpt_final
  //
  // Empty string / unset → no level exclusion (default — same behavior
  // as before). Belt-and-suspenders even when active: Premier
  // tournaments don't have FIP draw snapshots, so they wouldn't be
  // processed anyway. This filter is the explicit safety net.
  FIP_DRAW_POPULATOR_EXCLUDE_LEVELS: z.string().default(''),
  // fip-entry-list-populator — simplified-pipeline writer #5 (PR 3).
  // Reads padelgod.entry_list_snapshots and UPSERTs public.players by
  // fip_id. Replaces the entry-list phase of static-reconciler. No
  // tournament-scope filters: the player set is universal, NULL-only
  // updates protect against clobbering source-priority data, and
  // dry-run + idempotency carry the rest. Same safety posture: default
  // OFF + dry-run ON so enabling it in Railway is a two-step commit.
  ENABLE_FIP_ENTRY_LIST_POPULATOR: boolEnv(false),
  FIP_ENTRY_LIST_POPULATOR_DRY_RUN: boolEnv(true),
  // fip-oop-writer — simplified-pipeline writer #2. Reads
  // padelgod.oop_snapshots and UPDATEs public.matches.court +
  // court_order on composite-keyed rows (created by fip-draw-populator).
  // Same safety posture as the populator: default OFF + dry-run ON.
  ENABLE_FIP_OOP_WRITER: boolEnv(false),
  FIP_OOP_WRITER_DRY_RUN: boolEnv(true),
  // fip-draw-reconciler — auto-corrects public.matches when the latest
  // fip_event_page draw_snapshot disagrees (the populator's NULL-only
  // fill rule never overwrites already-set FKs, so a mid-tournament draw
  // edit leaves stale teams pinned). Safety posture: default OFF +
  // dry-run ON. See docs/superpowers/specs/2026-05-26-fip-draw-reconciler-design.md.
  ENABLE_FIP_DRAW_RECONCILER: boolEnv(false),
  FIP_DRAW_RECONCILER_DRY_RUN: boolEnv(true),
  // fip-results-writer — simplified-pipeline writer #3. Reads
  // padelgod.results_snapshots and UPDATEs matches.status + winner_pair
  // + UPSERTs sets rows for composite-keyed matches. Same safety
  // posture as the other writers.
  ENABLE_FIP_RESULTS_WRITER: boolEnv(false),
  FIP_RESULTS_WRITER_DRY_RUN: boolEnv(true),
  // fip-draw-results-writer — settles pre-match walkovers that the FIP
  // event page captures but matchscorerlive never publishes a results
  // row for. Reads padelgod.draw_snapshots (source='fip_event_page')
  // and flips public.matches.status + winner_pair on composite-keyed
  // rows. See worker docblock for the translation table. Same safety
  // posture as the other writers (default OFF + dry-run ON).
  ENABLE_FIP_DRAW_RESULTS_WRITER: boolEnv(false),
  FIP_DRAW_RESULTS_WRITER_DRY_RUN: boolEnv(true),
  // fip-winner-propagator — simplified-pipeline writer #4. When a match
  // is finished with a winner, the propagator copies the winning pair's
  // 2 player UUIDs into the next-round match via bracket math. Pure
  // DB-to-DB (no external calls). Same safety posture: default OFF +
  // dry-run ON.
  ENABLE_FIP_WINNER_PROPAGATOR: boolEnv(false),
  FIP_WINNER_PROPAGATOR_DRY_RUN: boolEnv(true),
  // FIP draw linker. Reads latest fip_event_page snapshots and writes
  // `entity_external_ids` rows that map Crionet widget composites
  // (e.g. "FIP-2026-1701:MD003") to `public.matches.id`. Without this,
  // matches created by `fip-draw-populator` are invisible to the
  // match-stats-fetcher (which only reads from `entity_external_ids`)
  // — Brussels P2 2026 had 27 finished Premier matches stranded with
  // no stats coverage because of exactly this gap. Enabled by default;
  // hourly :42 cron writes the missing linkages idempotently
  // (`ignoreDuplicates: true` on the unique composite — never stomps
  // an existing row).
  ENABLE_FIP_DRAW_LINKER: boolEnv(true),
  // Linker dry-run switch. Default OFF (writes enabled). Flip via Railway
  // env if you ever want to re-validate proposed linkages on a real run
  // before any rows land. The worker logs every linkage either way.
  FIP_DRAW_LINKER_DRY_RUN: boolEnv(false),
  ENABLE_OOP_FETCHER: boolEnv(true),
  ENABLE_RESULTS_FETCHER: boolEnv(true),
  ENABLE_STATIC_RECONCILER: boolEnv(true),
  ENABLE_MATCH_STATS_FETCHER: boolEnv(true),
  ENABLE_LIVE_POLLER_MANAGER: boolEnv(true),
  ENABLE_SHADOW_DIFF_FINALIZER: boolEnv(true),
  ENABLE_SHADOW_DIFF_LIVE: boolEnv(true),
  // OCR diff worker — compares padelgod.ocr_snapshots against public.sets.
  // Enabled by operator in Railway after the Python OCR worker (Task 11)
  // is deployed and producing padelgod.ocr_snapshots rows.
  ENABLE_SHADOW_DIFF_OCR: boolEnv(false),
  ENABLE_CLOSE_STALE_LIVE_SWEEPER: boolEnv(true),
  // fip-cms-orphan-prune — stamps + sweeps orphan FIP-source tournament
  // rows whose slugs disappeared from the FIP WP /events response. Runs
  // daily at 04:15 UTC. Default OFF — operator flips on in Railway
  // after the 2026-05-25 cleanup migration applies (which adds
  // ON DELETE CASCADE for padelgod.scrape_jobs.tournament_id; without
  // that the DELETE bounces on the FK and the worker logs a warn).
  ENABLE_FIP_CMS_ORPHAN_PRUNE: boolEnv(false),
  // Dry-run: when true (default), logs proposed stamps/clears/deletes
  // but makes no DB writes. Flip to false once the first day's log
  // output looks correct.
  FIP_CMS_ORPHAN_PRUNE_DRY_RUN: boolEnv(true),
  // schedule-hints-writer — computes per-match `late_hint` ("may be late" /
  // "starting soon" / null) for the matches list UI. Runs every 2 min.
  // Default ON; disable via ENABLE_SCHEDULE_HINTS_WRITER=false.
  ENABLE_SCHEDULE_HINTS_WRITER: boolEnv(true),
  // Dry-run: when true (default), logs proposed UPDATEs but makes no DB
  // writes. Flip to false in Railway once dry-run output looks correct.
  SCHEDULE_HINTS_WRITER_DRY_RUN: boolEnv(true),
  // Override the "running over" threshold (minutes). Default 90. Tune if
  // the average match duration at the venues warrants it.
  SCHEDULE_HINTS_EXPECTED_DURATION_MIN: z.coerce.number().int().positive().default(90),
  // Web push notification hook — set to the padelnachos.com origin to fire
  // `/api/push/notify` whenever padelgod flips a match out of `scheduled`.
  // Both vars optional: if either is unset, notify is skipped silently (so
  // local/test runs don't crash). CRON_SECRET must match the Vercel value.
  // See live-poller-loop.ts::notifyLiveTransition.
  NOTIFY_BASE_URL: z.string().url().optional(),
  CRON_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid environment variables: ${issues}`);
  }
  return parsed.data;
}
