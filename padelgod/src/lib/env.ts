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
