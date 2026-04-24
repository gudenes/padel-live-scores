import { z } from 'zod';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  PADELGOD_ADMIN_TOKEN: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ENABLE_SCHEDULER: z.coerce.boolean().default(true),
  ENABLE_TOURNAMENT_DISCOVERY: z.coerce.boolean().default(true),
  ENABLE_WIDGET_CODE_LOOKUP: z.coerce.boolean().default(true),
  ENABLE_PLAYER_RANKINGS: z.coerce.boolean().default(true),
  ENABLE_PLAYER_PROFILE: z.coerce.boolean().default(true),
  ENABLE_ENTRY_LIST_FETCHER: z.coerce.boolean().default(true),
  ENABLE_DRAW_FETCHER: z.coerce.boolean().default(true),
  // FIP event-page draw fetcher (PR 1 of the draw-linker pipeline). Source =
  // `fip_event_page`; writes to padelgod.draw_snapshots with match_widget_id
  // populated. Default OFF while we verify data quality on Brussels; flip
  // per-deploy via Railway env once confident. No writes to public.matches yet.
  ENABLE_FIP_DRAW_FETCHER: z.coerce.boolean().default(false),
  // fip-draw-populator — simplified-pipeline writer #1. Reads
  // padelgod.draw_snapshots (source='fip_event_page') and creates/updates
  // public.matches keyed by widget_id_composite. Intentionally parallel to
  // the legacy static-reconciler — see
  // docs/superpowers/specs/2026-04-24-simplified-pipeline-architecture.md.
  // Defaults OFF + DRY-RUN so enabling it in Railway is a two-step commit.
  ENABLE_FIP_DRAW_POPULATOR: z.coerce.boolean().default(false),
  FIP_DRAW_POPULATOR_DRY_RUN: z.coerce.boolean().default(true),
  // fip-oop-writer — simplified-pipeline writer #2. Reads
  // padelgod.oop_snapshots and UPDATEs public.matches.court +
  // court_order on composite-keyed rows (created by fip-draw-populator).
  // Same safety posture as the populator: default OFF + dry-run ON.
  ENABLE_FIP_OOP_WRITER: z.coerce.boolean().default(false),
  FIP_OOP_WRITER_DRY_RUN: z.coerce.boolean().default(true),
  // fip-results-writer — simplified-pipeline writer #3. Reads
  // padelgod.results_snapshots and UPDATEs matches.status + winner_pair
  // + UPSERTs sets rows for composite-keyed matches. Same safety
  // posture as the other writers.
  ENABLE_FIP_RESULTS_WRITER: z.coerce.boolean().default(false),
  FIP_RESULTS_WRITER_DRY_RUN: z.coerce.boolean().default(true),
  // FIP draw linker (PR 2). Reads latest fip_event_page snapshots and
  // writes `entity_external_ids` rows mapping Crionet widget composites
  // to public.matches UUIDs. Default OFF; enables via Railway env.
  ENABLE_FIP_DRAW_LINKER: z.coerce.boolean().default(false),
  // Linker dry-run switch. When true (default), the worker logs every
  // proposed linkage but writes nothing — lets operators review the
  // matches on real traffic before any canonical data moves. Flip to
  // `false` after the first dry-run confirms the expected links fire.
  FIP_DRAW_LINKER_DRY_RUN: z.coerce.boolean().default(true),
  ENABLE_OOP_FETCHER: z.coerce.boolean().default(true),
  ENABLE_RESULTS_FETCHER: z.coerce.boolean().default(true),
  ENABLE_STATIC_RECONCILER: z.coerce.boolean().default(true),
  ENABLE_MATCH_STATS_FETCHER: z.coerce.boolean().default(true),
  ENABLE_LIVE_POLLER_MANAGER: z.coerce.boolean().default(true),
  ENABLE_SHADOW_DIFF_FINALIZER: z.coerce.boolean().default(true),
  ENABLE_SHADOW_DIFF_LIVE: z.coerce.boolean().default(true),
  ENABLE_CLOSE_STALE_LIVE_SWEEPER: z.coerce.boolean().default(true),
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
