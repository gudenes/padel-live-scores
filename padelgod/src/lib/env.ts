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
