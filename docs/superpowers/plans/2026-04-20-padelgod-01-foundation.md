# Padelgod Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the empty `/padelgod` Node.js service skeleton with all Postgres schema changes applied, deployed to Railway. Subsequent plans (Discovery, Static, Live, Admin API) build workers on top of this foundation.

**Architecture:** New `/padelgod` directory in monorepo (sibling to `/relay`), TypeScript Node.js service deployed to Railway, writes to existing Supabase project via service-role key. New `padelgod` Postgres schema isolates scraper-internal state; public-schema additions (`match_points`, `public_id` columns, timestamps trigger) prepare ground for live pipeline. No workers shipped in this plan — only the empty service responding to `/health`.

**Tech Stack:** Node.js 20, TypeScript 5, Fastify 4, pino (logging), @supabase/supabase-js 2, vitest 4, Postgres 15 (Supabase), Railway (deploy), GitHub Actions (CI).

**Companion specs:**
- `docs/superpowers/specs/2026-04-20-padelgod-design.md`
- `docs/superpowers/specs/2026-04-20-padelgod-api-schema.md`
- `docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md`

**Prerequisites (already done by user):**
- Railway project created with `padelgod` service connected to GitHub repo, root directory `/padelgod`
- `PADELGOD_ADMIN_TOKEN` generated via `openssl rand -hex 32`

**Migration application:** Each migration is a self-contained `.sql` file in `supabase/migrations/`. Apply via either:
- **Supabase CLI:** `supabase migration up` (after `supabase init` + `supabase link --project-ref <ref>`), OR
- **Supabase Dashboard:** open SQL editor, paste file contents, run

Each migration ends with a verification block that fails loudly if the migration didn't apply correctly. Verification is a hard ASSERT — no silent failures.

---

## File Structure

**New files:**
```
padelgod/
├── package.json                           # Service manifest, deps, scripts
├── tsconfig.json                          # TypeScript config
├── .gitignore                             # Local artifacts
├── .env.example                           # Required env vars (no real values)
├── Dockerfile                             # Multi-stage Node 20 build for Railway
├── railway.toml                           # Railway service config
├── README.md                              # /padelgod-specific docs
├── vitest.config.ts                       # Test runner config
├── src/
│   ├── index.ts                           # Entry point: starts Fastify + scheduler skeleton
│   ├── lib/
│   │   ├── env.ts                         # Env var loading + validation (zod)
│   │   ├── logger.ts                      # pino logger factory
│   │   ├── supabase.ts                    # Service-role Supabase client
│   │   └── db-types.ts                    # TypeScript types reflecting new schema additions
│   ├── api/
│   │   └── health.ts                      # GET /health endpoint
│   └── __tests__/
│       ├── env.test.ts
│       ├── logger.test.ts
│       ├── supabase.test.ts
│       └── health.test.ts

supabase/migrations/
├── 20260420000001_padelgod_public_id_function.sql
├── 20260420000002_padelgod_set_updated_at_function.sql
├── 20260420000003_padelgod_tournaments_slug_publicid_timestamps.sql
├── 20260420000004_padelgod_players_slug_publicid_timestamps.sql
├── 20260420000005_padelgod_matches_publicid_timestamps_provenance.sql
├── 20260420000006_padelgod_sets_games_publicid_timestamps_server.sql
├── 20260420000007_padelgod_match_points_table.sql
├── 20260420000008_padelgod_padel_specific_flags.sql
├── 20260420000009_padelgod_schema_scrape_jobs_widget_cache.sql
├── 20260420000010_padelgod_schema_payloads_unresolved.sql
└── 20260420000011_padelgod_backfill_publicid_slug.sql

.github/workflows/
└── padelgod-ci.yml                        # Lint + typecheck + test on PR
```

**Modified files:** none in main app source. Root-level `.gitignore` may get a small addition.

---

### Task 1: Bootstrap `/padelgod` directory

**Files:**
- Create: `padelgod/package.json`
- Create: `padelgod/tsconfig.json`
- Create: `padelgod/.gitignore`
- Create: `padelgod/src/index.ts` (placeholder)

- [ ] **Step 1: Create `padelgod/package.json`**

```json
{
  "name": "padelgod",
  "version": "0.1.0",
  "description": "Padel data scraping service — sources tournaments/players/draws/OOP/live scores from FIP",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "fastify": "^4.28.1",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Create `padelgod/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/__tests__/**"]
}
```

- [ ] **Step 3: Create `padelgod/.gitignore`**

```
node_modules/
dist/
.env
.env.local
*.log
coverage/
.DS_Store
```

- [ ] **Step 4: Create placeholder `padelgod/src/index.ts`**

```typescript
console.log('padelgod boot');
```

- [ ] **Step 5: Install deps**

Run from `padelgod/`:
```bash
cd padelgod && npm install
```
Expected: `node_modules/` populated, no errors.

- [ ] **Step 6: Commit**

```bash
git add padelgod/package.json padelgod/tsconfig.json padelgod/.gitignore padelgod/src/index.ts padelgod/package-lock.json
git commit -m "chore(padelgod): bootstrap /padelgod TypeScript service skeleton"
```

---

### Task 2: Add env loader with zod validation

**Files:**
- Create: `padelgod/src/lib/env.ts`
- Create: `padelgod/src/__tests__/env.test.ts`
- Create: `padelgod/.env.example`
- Create: `padelgod/vitest.config.ts`

- [ ] **Step 1: Create `padelgod/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
```

- [ ] **Step 2: Write the failing test `padelgod/src/__tests__/env.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { loadEnv } from '../lib/env.js';

describe('loadEnv', () => {
  it('parses valid env vars', () => {
    const env = loadEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'service-key-value',
      PADELGOD_ADMIN_TOKEN: 'admin-token-value',
      NODE_ENV: 'test',
      PORT: '3002',
    });
    expect(env.SUPABASE_URL).toBe('https://example.supabase.co');
    expect(env.PORT).toBe(3002);
    expect(env.NODE_ENV).toBe('test');
  });

  it('throws when SUPABASE_URL is missing', () => {
    expect(() =>
      loadEnv({
        SUPABASE_SERVICE_KEY: 'k',
        PADELGOD_ADMIN_TOKEN: 't',
      })
    ).toThrow(/SUPABASE_URL/);
  });

  it('coerces PORT to number with default 3002', () => {
    const env = loadEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'k',
      PADELGOD_ADMIN_TOKEN: 't',
    });
    expect(env.PORT).toBe(3002);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd padelgod && npx vitest run src/__tests__/env.test.ts
```
Expected: FAIL — module `../lib/env.js` not found.

- [ ] **Step 4: Create `padelgod/src/lib/env.ts`**

```typescript
import { z } from 'zod';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  PADELGOD_ADMIN_TOKEN: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
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
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd padelgod && npx vitest run src/__tests__/env.test.ts
```
Expected: PASS (3/3).

- [ ] **Step 6: Create `padelgod/.env.example`**

```
# Supabase (reuse from main app)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Padelgod admin API auth (generate via: openssl rand -hex 32)
PADELGOD_ADMIN_TOKEN=your-admin-token

# Optional
PORT=3002
NODE_ENV=development
LOG_LEVEL=info
```

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/lib/env.ts padelgod/src/__tests__/env.test.ts padelgod/.env.example padelgod/vitest.config.ts
git commit -m "feat(padelgod): add zod-validated env loader with tests"
```

---

### Task 3: Add structured logger (pino)

**Files:**
- Create: `padelgod/src/lib/logger.ts`
- Create: `padelgod/src/__tests__/logger.test.ts`

- [ ] **Step 1: Write the failing test `padelgod/src/__tests__/logger.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { createLogger } from '../lib/logger.js';

describe('createLogger', () => {
  it('returns a pino logger with the configured level', () => {
    const logger = createLogger({ level: 'warn', service: 'padelgod-test' });
    expect(logger.level).toBe('warn');
  });

  it('includes service name in bindings', () => {
    const logger = createLogger({ level: 'info', service: 'padelgod-svc' });
    expect(logger.bindings()).toMatchObject({ service: 'padelgod-svc' });
  });

  it('child logger inherits bindings and adds new ones', () => {
    const root = createLogger({ level: 'info', service: 'padelgod' });
    const child = root.child({ worker: 'tournament-discovery' });
    expect(child.bindings()).toMatchObject({ service: 'padelgod', worker: 'tournament-discovery' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd padelgod && npx vitest run src/__tests__/logger.test.ts
```
Expected: FAIL — `../lib/logger.js` not found.

- [ ] **Step 3: Create `padelgod/src/lib/logger.ts`**

```typescript
import pino, { type Logger } from 'pino';

export interface LoggerOptions {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  service: string;
}

export function createLogger(opts: LoggerOptions): Logger {
  const isProduction = process.env.NODE_ENV === 'production';
  return pino({
    level: opts.level,
    base: { service: opts.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(isProduction
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd padelgod && npx vitest run src/__tests__/logger.test.ts
```
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/logger.ts padelgod/src/__tests__/logger.test.ts
git commit -m "feat(padelgod): add pino structured logger with service bindings"
```

---

### Task 4: Add Supabase service-role client

**Files:**
- Create: `padelgod/src/lib/supabase.ts`
- Create: `padelgod/src/__tests__/supabase.test.ts`

- [ ] **Step 1: Write the failing test `padelgod/src/__tests__/supabase.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { createSupabaseClient } from '../lib/supabase.js';

describe('createSupabaseClient', () => {
  it('returns a Supabase client configured with service-role key', () => {
    const client = createSupabaseClient({
      url: 'https://example.supabase.co',
      serviceKey: 'fake-service-key',
    });
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });

  it('throws when url is missing', () => {
    expect(() =>
      createSupabaseClient({ url: '', serviceKey: 'k' })
    ).toThrow(/url/i);
  });

  it('throws when serviceKey is missing', () => {
    expect(() =>
      createSupabaseClient({ url: 'https://x.supabase.co', serviceKey: '' })
    ).toThrow(/service.*key/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd padelgod && npx vitest run src/__tests__/supabase.test.ts
```
Expected: FAIL — `../lib/supabase.js` not found.

- [ ] **Step 3: Create `padelgod/src/lib/supabase.ts`**

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseClientOptions {
  url: string;
  serviceKey: string;
}

export function createSupabaseClient(opts: SupabaseClientOptions): SupabaseClient {
  if (!opts.url) throw new Error('Supabase url is required');
  if (!opts.serviceKey) throw new Error('Supabase service key is required');
  return createClient(opts.url, opts.serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd padelgod && npx vitest run src/__tests__/supabase.test.ts
```
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/supabase.ts padelgod/src/__tests__/supabase.test.ts
git commit -m "feat(padelgod): add Supabase service-role client factory"
```

---

### Task 5: Add health endpoint (Fastify)

**Files:**
- Create: `padelgod/src/api/health.ts`
- Create: `padelgod/src/__tests__/health.test.ts`

- [ ] **Step 1: Write the failing test `padelgod/src/__tests__/health.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoute } from '../api/health.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  registerHealthRoute(app, { startedAt: new Date('2026-04-20T10:00:00Z'), version: '0.1.0' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with status ok and uptime info', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe('ok');
    expect(body.data.version).toBe('0.1.0');
    expect(typeof body.data.uptime_seconds).toBe('number');
    expect(body.data.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd padelgod && npx vitest run src/__tests__/health.test.ts
```
Expected: FAIL — `../api/health.js` not found.

- [ ] **Step 3: Create `padelgod/src/api/health.ts`**

```typescript
import type { FastifyInstance } from 'fastify';

export interface HealthRouteOptions {
  startedAt: Date;
  version: string;
}

export function registerHealthRoute(app: FastifyInstance, opts: HealthRouteOptions): void {
  app.get('/health', async () => {
    const uptimeMs = Date.now() - opts.startedAt.getTime();
    return {
      data: {
        status: 'ok',
        uptime_seconds: Math.floor(uptimeMs / 1000),
        version: opts.version,
      },
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd padelgod && npx vitest run src/__tests__/health.test.ts
```
Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/api/health.ts padelgod/src/__tests__/health.test.ts
git commit -m "feat(padelgod): add /health endpoint returning status + uptime + version"
```

---

### Task 6: Wire entry point (`src/index.ts`)

**Files:**
- Modify: `padelgod/src/index.ts`

- [ ] **Step 1: Replace placeholder content**

```typescript
import Fastify from 'fastify';
import { loadEnv } from './lib/env.js';
import { createLogger } from './lib/logger.js';
import { createSupabaseClient } from './lib/supabase.js';
import { registerHealthRoute } from './api/health.js';

const VERSION = '0.1.0';
const startedAt = new Date();

async function main() {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, service: 'padelgod' });

  // Initialize Supabase client (validates connectivity at first query, not boot)
  const supabase = createSupabaseClient({
    url: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_KEY,
  });
  logger.info({ url: env.SUPABASE_URL }, 'Supabase client initialized');

  // Fastify app
  const app = Fastify({
    logger: false, // we use pino directly via logger var
    trustProxy: true,
  });

  registerHealthRoute(app, { startedAt, version: VERSION });

  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err }, 'Unhandled error');
    reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  try {
    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ address, version: VERSION }, 'padelgod listening');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Touch supabase to silence unused-var; replaced by real workers in Plan 2+
  void supabase;
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run typecheck**

```bash
cd padelgod && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
cd padelgod && npm test
```
Expected: PASS (env: 3, logger: 3, supabase: 3, health: 1 — total 10).

- [ ] **Step 4: Smoke test locally**

Create a `.env` from the example:
```bash
cd padelgod && cp .env.example .env
```
Edit `.env` with real Supabase + admin token values from the main app's `.env`.

Then:
```bash
npm run dev
```
In another terminal:
```bash
curl -s http://localhost:3002/health | python3 -m json.tool
```
Expected output:
```json
{
  "data": {
    "status": "ok",
    "uptime_seconds": 0,
    "version": "0.1.0"
  }
}
```

Stop the dev server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/index.ts
git commit -m "feat(padelgod): wire entry point with Fastify + graceful shutdown"
```

---

### Task 7: Add Dockerfile + Railway config

**Files:**
- Create: `padelgod/Dockerfile`
- Create: `padelgod/.dockerignore`
- Create: `padelgod/railway.toml`

- [ ] **Step 1: Create `padelgod/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ---- builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 3002
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create `padelgod/.dockerignore`**

```
node_modules
dist
.env
.env.local
*.log
.DS_Store
__tests__
coverage
README.md
```

- [ ] **Step 3: Create `padelgod/railway.toml`**

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/index.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

- [ ] **Step 4: Local Docker build smoke test**

```bash
cd padelgod && docker build -t padelgod-test:local .
```
Expected: build succeeds, no errors. Image tagged `padelgod-test:local`.

If Docker isn't installed locally, skip the build test and proceed; Railway will catch issues on deploy.

- [ ] **Step 5: Commit**

```bash
git add padelgod/Dockerfile padelgod/.dockerignore padelgod/railway.toml
git commit -m "build(padelgod): add Dockerfile + Railway config"
```

---

### Task 8: Migration — `public_id()` Postgres function

**Files:**
- Create: `supabase/migrations/20260420000001_padelgod_public_id_function.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: public_id() function generates Stripe-style prefixed nanoid IDs.
-- Format: {prefix}_{12 base62 chars}, e.g., 'tour_8Kx3mPq2RvN5'.

CREATE OR REPLACE FUNCTION public.public_id(prefix TEXT)
RETURNS TEXT AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..12 LOOP
    result := result || substr(alphabet, 1 + floor(random() * 62)::int, 1);
  END LOOP;
  RETURN prefix || '_' || result;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION public.public_id(TEXT) IS
  'Generates Padelgod public IDs in format {prefix}_{12-char base62}. Used as DEFAULT on entity public_id columns.';

-- Verification: ensure function exists and produces correctly-formatted IDs
DO $$
DECLARE
  sample TEXT;
BEGIN
  sample := public.public_id('tst');
  ASSERT length(sample) = 16, format('Expected length 16, got %s for sample %L', length(sample), sample);
  ASSERT sample LIKE 'tst\_%' ESCAPE '\', format('Expected prefix tst_, got %L', sample);
END $$;
```

- [ ] **Step 2: Apply migration**

Either:
- **CLI:** `supabase migration up` (from repo root, after `supabase link`)
- **Dashboard:** Supabase → SQL Editor → New Query → paste file contents → Run

Expected: "Success. No rows returned" — DO block doesn't fail.

- [ ] **Step 3: Verify in dashboard**

In SQL Editor, run:
```sql
SELECT public.public_id('test') AS sample_id;
```
Expected: a row like `test_abc123xyz789Q`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260420000001_padelgod_public_id_function.sql
git commit -m "feat(db): add public_id() function for Padelgod prefixed nanoid IDs"
```

---

### Task 9: Migration — `set_updated_at()` trigger function

**Files:**
- Create: `supabase/migrations/20260420000002_padelgod_set_updated_at_function.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: shared trigger function to keep updated_at in sync on every UPDATE.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Trigger function: sets NEW.updated_at = NOW() on every UPDATE. Apply via BEFORE UPDATE trigger on every entity table.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pronamespace = 'public'::regnamespace
  ), 'public.set_updated_at() function not found';
END $$;
```

- [ ] **Step 2: Apply migration** (same as Task 8 step 2)

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420000002_padelgod_set_updated_at_function.sql
git commit -m "feat(db): add set_updated_at() trigger function"
```

---

### Task 10: Migration — Tournaments slug + public_id + timestamps

**Files:**
- Create: `supabase/migrations/20260420000003_padelgod_tournaments_slug_publicid_timestamps.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: tournaments gets public_id, slug (renamed from fip_slug), updated_at.
-- created_at already exists on tournaments per existing schema.

-- Step 1: Rename fip_slug → slug (tournaments.fip_slug exists from migration 20260401000000)
ALTER TABLE public.tournaments RENAME COLUMN fip_slug TO slug;

-- Step 2: Add public_id (DEFAULT generates one per row at insert; backfill in Task 18)
ALTER TABLE public.tournaments
  ADD COLUMN public_id TEXT DEFAULT public.public_id('tour');

-- Note: UNIQUE + NOT NULL constraints applied AFTER backfill in Task 18.

-- Step 3: Add updated_at (created_at already present)
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Step 4: Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trg_tournaments_updated_at ON public.tournaments;
CREATE TRIGGER trg_tournaments_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'slug'
  ), 'tournaments.slug column missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'public_id'
  ), 'tournaments.public_id column missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'updated_at'
  ), 'tournaments.updated_at column missing';

  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'fip_slug'
  ), 'tournaments.fip_slug should have been renamed to slug';
END $$;
```

- [ ] **Step 2: Apply migration** (CLI or Dashboard).

Expected: success.

- [ ] **Step 3: Verify rename worked**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='tournaments'
  AND column_name IN ('slug','fip_slug','public_id','updated_at');
```
Expected rows: `slug`, `public_id`, `updated_at` (NO `fip_slug`).

- [ ] **Step 4: Check existing code references for `fip_slug`**

```bash
cd /Users/GuDenes/Projects/padel-live-scores && grep -rn "fip_slug" src/ supabase/migrations/ --include="*.ts" --include="*.tsx" --include="*.sql" 2>/dev/null | grep -v "20260401000000_add_fip_tournament_columns.sql" | grep -v "20260420000003"
```

If matches exist, the migration broke them. Each match is a separate code change required:
- For TypeScript files: rename `fip_slug` → `slug` in queries and types
- These shouldn't be many; if any are found, fix them and add to this commit

If no matches: clean rename, proceed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260420000003_padelgod_tournaments_slug_publicid_timestamps.sql
# also add any TS files modified in step 4
git commit -m "feat(db): tournaments adds public_id + updated_at; renames fip_slug → slug"
```

---

### Task 11: Migration — Players slug + public_id + timestamps

**Files:**
- Create: `supabase/migrations/20260420000004_padelgod_players_slug_publicid_timestamps.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: players gets public_id, slug, updated_at.

ALTER TABLE public.players
  ADD COLUMN public_id TEXT DEFAULT public.public_id('plr');

ALTER TABLE public.players
  ADD COLUMN slug TEXT;
-- (slug computed from name in backfill, Task 18; UNIQUE applied there)

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_players_updated_at ON public.players;
CREATE TRIGGER trg_players_updated_at
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='public_id'),
    'players.public_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='slug'),
    'players.slug missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='created_at'),
    'players.created_at missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='players' AND column_name='updated_at'),
    'players.updated_at missing';
END $$;
```

- [ ] **Step 2: Apply migration**

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420000004_padelgod_players_slug_publicid_timestamps.sql
git commit -m "feat(db): players adds public_id + slug + timestamps"
```

---

### Task 12: Migration — Matches public_id + timestamps + provenance

**Files:**
- Create: `supabase/migrations/20260420000005_padelgod_matches_publicid_timestamps_provenance.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: matches gets public_id, timestamps, provenance + migration feature flag fields.

ALTER TABLE public.matches
  ADD COLUMN public_id TEXT DEFAULT public.public_id('mat');

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Coarse provenance (which writer last touched the row)
ALTER TABLE public.matches
  ADD COLUMN last_updated_by TEXT;
COMMENT ON COLUMN public.matches.last_updated_by IS
  'Source of the most recent UPDATE: padelapi | padelgod | manual';

DROP TRIGGER IF EXISTS trg_matches_updated_at ON public.matches;
CREATE TRIGGER trg_matches_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-tournament migration cutover flag — added on tournaments here for locality
ALTER TABLE public.tournaments
  ADD COLUMN live_source TEXT NOT NULL DEFAULT 'padelapi'
  CHECK (live_source IN ('padelapi', 'padelgod'));
COMMENT ON COLUMN public.tournaments.live_source IS
  'Migration feature flag: which source owns live data for this tournament.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='matches' AND column_name='public_id'),
    'matches.public_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='matches' AND column_name='last_updated_by'),
    'matches.last_updated_by missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments' AND column_name='live_source'),
    'tournaments.live_source missing';
END $$;
```

- [ ] **Step 2: Apply migration**

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420000005_padelgod_matches_publicid_timestamps_provenance.sql
git commit -m "feat(db): matches adds public_id + timestamps + provenance; tournaments.live_source flag"
```

---

### Task 13: Migration — Sets + games public_id + timestamps + server

**Files:**
- Create: `supabase/migrations/20260420000006_padelgod_sets_games_publicid_timestamps_server.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: sets + games get public_id + timestamps; games gets server_player_id.

-- sets
ALTER TABLE public.sets
  ADD COLUMN public_id TEXT DEFAULT public.public_id('set');

ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_sets_updated_at ON public.sets;
CREATE TRIGGER trg_sets_updated_at
  BEFORE UPDATE ON public.sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- games
ALTER TABLE public.games
  ADD COLUMN public_id TEXT DEFAULT public.public_id('gam');

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_games_updated_at ON public.games;
CREATE TRIGGER trg_games_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-game server (rotates each game in padel)
ALTER TABLE public.games
  ADD COLUMN server_player_id UUID REFERENCES public.players(id);
COMMENT ON COLUMN public.games.server_player_id IS
  'Player who served this entire game (server alternates each game in padel).';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sets' AND column_name='public_id'),
    'sets.public_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='games' AND column_name='public_id'),
    'games.public_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='games' AND column_name='server_player_id'),
    'games.server_player_id missing';
END $$;
```

- [ ] **Step 2: Apply migration**

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420000006_padelgod_sets_games_publicid_timestamps_server.sql
git commit -m "feat(db): sets+games add public_id+timestamps; games adds server_player_id"
```

---

### Task 14: Migration — `match_points` table

**Files:**
- Create: `supabase/migrations/20260420000007_padelgod_match_points_table.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: per-point structured data table (the table we never had).
-- Padelgod live-poller writes one row per detected point during live polling.
-- For matches scraped retroactively, server_player_id is NULL.

CREATE TABLE public.match_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT UNIQUE NOT NULL DEFAULT public.public_id('pnt'),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_id   UUID NOT NULL REFERENCES public.sets(id)    ON DELETE CASCADE,
  game_id  UUID NOT NULL REFERENCES public.games(id)   ON DELETE CASCADE,
  point_number INT NOT NULL,
  server_player_id UUID REFERENCES public.players(id),
  winner_pair INT NOT NULL CHECK (winner_pair IN (1, 2)),
  score_after TEXT NOT NULL,
  is_break_point BOOLEAN NOT NULL DEFAULT false,
  is_set_point   BOOLEAN NOT NULL DEFAULT false,
  is_match_point BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'padelgod' CHECK (source IN ('padelgod', 'padelapi', 'inferred')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, point_number)
);

CREATE INDEX idx_match_points_match  ON public.match_points(match_id);
CREATE INDEX idx_match_points_server ON public.match_points(server_player_id);
CREATE INDEX idx_match_points_recent ON public.match_points(created_at DESC);

CREATE TRIGGER trg_match_points_updated_at
  BEFORE UPDATE ON public.match_points
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.match_points IS
  'Per-point structured data, populated by Padelgod live-poller. server_player_id NULL for retroactive imports.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='match_points'),
    'match_points table missing';
  ASSERT EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='match_points' AND indexname='idx_match_points_match'),
    'idx_match_points_match index missing';
END $$;
```

- [ ] **Step 2: Apply migration**

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420000007_padelgod_match_points_table.sql
git commit -m "feat(db): add match_points table for per-point structured data"
```

---

### Task 15: Migration — Padel-specific flags (tiebreak + golden point)

**Files:**
- Create: `supabase/migrations/20260420000008_padelgod_padel_specific_flags.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: padel-specific game/point flags.

ALTER TABLE public.games
  ADD COLUMN is_tiebreak BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.games.is_tiebreak IS
  'True when this game is a tiebreak (e.g., the 13th game at 6-6).';

ALTER TABLE public.tournaments
  ADD COLUMN uses_golden_point BOOLEAN;
COMMENT ON COLUMN public.tournaments.uses_golden_point IS
  'NULL=unknown, true=tournament replaces deuce with sudden-death point, false=traditional deuce.';

ALTER TABLE public.match_points
  ADD COLUMN is_golden_point BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.match_points.is_golden_point IS
  'True when this point was a sudden-death decider; only meaningful when tournament.uses_golden_point=true.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='games' AND column_name='is_tiebreak'),
    'games.is_tiebreak missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments' AND column_name='uses_golden_point'),
    'tournaments.uses_golden_point missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='match_points' AND column_name='is_golden_point'),
    'match_points.is_golden_point missing';
END $$;
```

- [ ] **Step 2: Apply migration**

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420000008_padelgod_padel_specific_flags.sql
git commit -m "feat(db): add padel-specific flags (tiebreak, golden point)"
```

---

### Task 16: Migration — `padelgod` schema + scrape_jobs + widget_id_cache

**Files:**
- Create: `supabase/migrations/20260420000009_padelgod_schema_scrape_jobs_widget_cache.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: scraper-internal state lives in its own schema.

CREATE SCHEMA IF NOT EXISTS padelgod;
COMMENT ON SCHEMA padelgod IS 'Padelgod scraper-internal state — operational logs, caches, queues. Not for app reads.';

-- 1. Operational log: every scrape attempt
CREATE TABLE padelgod.scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  tournament_id UUID REFERENCES public.tournaments(id),
  target_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  error_message TEXT,
  parser_version TEXT
);
CREATE INDEX idx_scrape_jobs_recent     ON padelgod.scrape_jobs(started_at DESC);
CREATE INDEX idx_scrape_jobs_tournament ON padelgod.scrape_jobs(tournament_id, job_type);
CREATE INDEX idx_scrape_jobs_status     ON padelgod.scrape_jobs(status, started_at DESC);

COMMENT ON TABLE padelgod.scrape_jobs IS
  'Every scrape attempt. job_type ∈ {discover, widget_id, draw, oop, live, rankings, profile, article, youtube}.';

-- 2. Widget code cache (durable so we don''t rediscover on every restart)
CREATE TABLE padelgod.widget_id_cache (
  tournament_id UUID PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  widget_id TEXT NOT NULL UNIQUE,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('search', 'iframe', 'page_regex', 'manual'))
);
CREATE INDEX idx_widget_id_cache_active ON padelgod.widget_id_cache(is_active, last_validated_at);

COMMENT ON TABLE padelgod.widget_id_cache IS
  'tournament_id → FIP widget code (e.g., FIP-2026-1701). Marked is_active=false when widget returns "No results".';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='padelgod'),
    'padelgod schema missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='scrape_jobs'),
    'padelgod.scrape_jobs missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='widget_id_cache'),
    'padelgod.widget_id_cache missing';
END $$;
```

- [ ] **Step 2: Apply migration**

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420000009_padelgod_schema_scrape_jobs_widget_cache.sql
git commit -m "feat(db): add padelgod schema + scrape_jobs + widget_id_cache tables"
```

---

### Task 17: Migration — `padelgod.raw_payloads` + `unresolved_players` + `unresolved_matches`

**Files:**
- Create: `supabase/migrations/20260420000010_padelgod_schema_payloads_unresolved.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: raw payload storage + human-review queues.

-- 3. Raw HTML payloads (replay + debugging)
CREATE TABLE padelgod.raw_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  byte_size INT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_raw_payloads_recent     ON padelgod.raw_payloads(captured_at DESC);
CREATE INDEX idx_raw_payloads_job        ON padelgod.raw_payloads(scrape_job_id);
CREATE INDEX idx_raw_payloads_hash       ON padelgod.raw_payloads(content_hash);

COMMENT ON TABLE padelgod.raw_payloads IS
  'Raw HTTP response bodies (HTML/JSON) for debugging and replay. Daily cron purges rows >48h old.';

-- 4. Human review queue: widget short-names we couldn''t resolve
CREATE TABLE padelgod.unresolved_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),
  widget_short_name TEXT NOT NULL,
  partner_short_name TEXT,
  match_id UUID REFERENCES public.matches(id),
  candidate_player_ids UUID[],
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'created_new', 'ignored')),
  resolved_player_id UUID REFERENCES public.players(id),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  UNIQUE (tournament_id, widget_short_name, partner_short_name)
);
CREATE INDEX idx_unresolved_players_pending ON padelgod.unresolved_players(status, first_seen_at DESC);

COMMENT ON TABLE padelgod.unresolved_players IS
  'Widget short-names that the per-tournament dictionary + pair disambiguation could not auto-resolve. Surfaced in ops dashboard.';

-- 5. Aggregate-divergence flags (when reconstructed point counts disagree with /screen/getmatchstats totals)
CREATE TABLE padelgod.unresolved_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),
  reason TEXT NOT NULL CHECK (reason IN ('point_count_divergence', 'set_score_mismatch', 'parser_error', 'other')),
  details JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
CREATE INDEX idx_unresolved_matches_pending ON padelgod.unresolved_matches(status, first_seen_at DESC);
CREATE INDEX idx_unresolved_matches_match   ON padelgod.unresolved_matches(match_id);

COMMENT ON TABLE padelgod.unresolved_matches IS
  'Matches where Padelgod''s reconstructed point count diverged >5% from /screen/getmatchstats totals.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='raw_payloads'),
    'padelgod.raw_payloads missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='unresolved_players'),
    'padelgod.unresolved_players missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='unresolved_matches'),
    'padelgod.unresolved_matches missing';
END $$;
```

- [ ] **Step 2: Apply migration**

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420000010_padelgod_schema_payloads_unresolved.sql
git commit -m "feat(db): add padelgod raw_payloads + unresolved_players + unresolved_matches tables"
```

---

### Task 18: Migration — Backfill `public_id` + slug + apply UNIQUE/NOT NULL

**Files:**
- Create: `supabase/migrations/20260420000011_padelgod_backfill_publicid_slug.sql`

This is the slowest migration (touches every existing row). For very large tables, consider running it during low-traffic hours.

- [ ] **Step 1: Create migration file**

```sql
-- Padelgod foundation: backfill public_id + slug for all existing rows, then enforce UNIQUE/NOT NULL.

-- Helper: slugify a string for player slugs.
CREATE OR REPLACE FUNCTION public.padelgod_slugify(input TEXT)
RETURNS TEXT AS $$
DECLARE
  normalized TEXT;
BEGIN
  IF input IS NULL OR length(trim(input)) = 0 THEN
    RETURN NULL;
  END IF;
  -- Lowercase, strip diacritics via unaccent if available, replace non-alphanumerics with hyphens
  normalized := lower(trim(input));
  -- unaccent extension already enabled (per existing migration 20260330_player_dedup_and_content_tagging)
  BEGIN
    normalized := public.unaccent(normalized);
  EXCEPTION WHEN undefined_function THEN
    -- unaccent not available; proceed without it
    NULL;
  END;
  normalized := regexp_replace(normalized, '[^a-z0-9]+', '-', 'g');
  normalized := regexp_replace(normalized, '^-+|-+$', '', 'g');
  RETURN normalized;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill players.slug with disambiguation suffix on collisions
DO $$
DECLARE
  rec RECORD;
  base_slug TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR rec IN SELECT id, name FROM public.players WHERE slug IS NULL LOOP
    base_slug := public.padelgod_slugify(rec.name);
    IF base_slug IS NULL THEN
      CONTINUE;  -- skip players with NULL/empty names
    END IF;
    candidate := base_slug;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM public.players WHERE slug = candidate AND id <> rec.id) LOOP
      suffix := suffix + 1;
      candidate := base_slug || '-' || suffix;
    END LOOP;
    UPDATE public.players SET slug = candidate WHERE id = rec.id;
  END LOOP;
END $$;

-- Backfill public_id where DEFAULT didn''t fire (existing rows pre-default)
UPDATE public.tournaments  SET public_id = public.public_id('tour') WHERE public_id IS NULL;
UPDATE public.players      SET public_id = public.public_id('plr')  WHERE public_id IS NULL;
UPDATE public.matches      SET public_id = public.public_id('mat')  WHERE public_id IS NULL;
UPDATE public.sets         SET public_id = public.public_id('set')  WHERE public_id IS NULL;
UPDATE public.games        SET public_id = public.public_id('gam')  WHERE public_id IS NULL;

-- Enforce UNIQUE + NOT NULL on public_id columns now that backfill is done
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_public_id_key UNIQUE (public_id);
ALTER TABLE public.tournaments ALTER COLUMN public_id SET NOT NULL;

ALTER TABLE public.players ADD CONSTRAINT players_public_id_key UNIQUE (public_id);
ALTER TABLE public.players ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE public.players ADD CONSTRAINT players_slug_key UNIQUE (slug);
-- players.slug stays nullable in case future rows have NULL/empty names

ALTER TABLE public.matches ADD CONSTRAINT matches_public_id_key UNIQUE (public_id);
ALTER TABLE public.matches ALTER COLUMN public_id SET NOT NULL;

ALTER TABLE public.sets ADD CONSTRAINT sets_public_id_key UNIQUE (public_id);
ALTER TABLE public.sets ALTER COLUMN public_id SET NOT NULL;

ALTER TABLE public.games ADD CONSTRAINT games_public_id_key UNIQUE (public_id);
ALTER TABLE public.games ALTER COLUMN public_id SET NOT NULL;

-- Verification
DO $$
DECLARE
  null_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM public.tournaments WHERE public_id IS NULL;
  ASSERT null_count = 0, format('%s tournaments have NULL public_id after backfill', null_count);

  SELECT COUNT(*) INTO null_count FROM public.players WHERE public_id IS NULL;
  ASSERT null_count = 0, format('%s players have NULL public_id after backfill', null_count);

  SELECT COUNT(*) INTO null_count FROM public.matches WHERE public_id IS NULL;
  ASSERT null_count = 0, format('%s matches have NULL public_id after backfill', null_count);

  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'players_public_id_key' AND contype = 'u'
  ), 'players_public_id_key UNIQUE constraint missing';
END $$;
```

- [ ] **Step 2: Apply migration**

This migration UPDATEs existing rows. Expected duration scales with row count:
- ~1k rows: <1s
- ~10k rows: ~5s
- ~100k rows: ~1min

Expected: success.

- [ ] **Step 3: Spot-check the backfill**

```sql
SELECT id, name, slug, public_id FROM public.players ORDER BY created_at LIMIT 5;
SELECT id, name, slug, public_id FROM public.tournaments ORDER BY created_at LIMIT 5;
```
Expected: every row has a non-null `public_id` like `plr_xxxxxxxxxxxxx`; players have slugs like `juan-lebron`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260420000011_padelgod_backfill_publicid_slug.sql
git commit -m "feat(db): backfill public_id + slug; enforce UNIQUE/NOT NULL"
```

---

### Task 19: Add shared TypeScript types reflecting new schema

**Files:**
- Create: `padelgod/src/lib/db-types.ts`

These types describe the new columns Padelgod cares about. The main app continues using its existing `src/types/match.ts` — Padelgod doesn't import from there to keep the boundary clean. We can extract a shared types package later if needed.

- [ ] **Step 1: Create `padelgod/src/lib/db-types.ts`**

```typescript
// TypeScript types reflecting Padelgod-relevant fields on Supabase tables.
// Hand-maintained for now — sync with migrations under supabase/migrations/2026042000000*.
// When this gets unwieldy, generate via `supabase gen types typescript`.

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'retired'
  | 'walkover'
  | 'suspended'
  | 'cancelled';

export type LiveSource = 'padelapi' | 'padelgod';

export type LastUpdatedBy = 'padelapi' | 'padelgod' | 'manual';

export interface Tournament {
  id: string;
  public_id: string;
  slug: string | null;
  name: string;
  level: string;
  starts_at: string | null;
  ends_at: string | null;
  live_source: LiveSource;
  uses_golden_point: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: string;
  public_id: string;
  slug: string | null;
  name: string;
  fip_id: string | null;
  country: string | null;
  ranking: number | null;
  points: number | null;
  created_at: string;
  updated_at: string;
}

export interface Match {
  id: string;
  public_id: string;
  status: MatchStatus;
  tournament_id: string;
  serving_player_id: string | null;
  last_updated_by: LastUpdatedBy | null;
  created_at: string;
  updated_at: string;
}

export interface Set {
  id: string;
  public_id: string;
  match_id: string;
  set_number: number;
  set_score: string | null;
  pair1_games: number;
  pair2_games: number;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface Game {
  id: string;
  public_id: string;
  match_id: string;
  set_id: string;
  game_number: number;
  game_score: string | null;
  is_current: boolean;
  is_tiebreak: boolean;
  server_player_id: string | null;
  winner_pair: number | null;
  created_at: string;
  updated_at: string;
}

export interface MatchPoint {
  id: string;
  public_id: string;
  match_id: string;
  set_id: string;
  game_id: string;
  point_number: number;
  server_player_id: string | null;
  winner_pair: 1 | 2;
  score_after: string;
  is_break_point: boolean;
  is_set_point: boolean;
  is_match_point: boolean;
  is_golden_point: boolean;
  source: 'padelgod' | 'padelapi' | 'inferred';
  created_at: string;
  updated_at: string;
}

// padelgod schema types
export type ScrapeJobType =
  | 'discover'
  | 'widget_id'
  | 'draw'
  | 'oop'
  | 'live'
  | 'rankings'
  | 'profile'
  | 'article'
  | 'youtube';

export type ScrapeJobStatus = 'queued' | 'running' | 'success' | 'failed';

export interface ScrapeJob {
  id: string;
  job_type: ScrapeJobType;
  tournament_id: string | null;
  target_url: string | null;
  status: ScrapeJobStatus;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  parser_version: string | null;
}

export interface WidgetIdCacheRow {
  tournament_id: string;
  widget_id: string;
  extracted_at: string;
  last_validated_at: string;
  is_active: boolean;
  extraction_method: 'search' | 'iframe' | 'page_regex' | 'manual';
}

export interface UnresolvedPlayer {
  id: string;
  tournament_id: string;
  widget_short_name: string;
  partner_short_name: string | null;
  match_id: string | null;
  candidate_player_ids: string[] | null;
  first_seen_at: string;
  status: 'pending' | 'resolved' | 'created_new' | 'ignored';
  resolved_player_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface UnresolvedMatch {
  id: string;
  match_id: string;
  tournament_id: string;
  reason: 'point_count_divergence' | 'set_score_mismatch' | 'parser_error' | 'other';
  details: Record<string, unknown>;
  status: 'pending' | 'resolved' | 'ignored';
  first_seen_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
cd padelgod && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/lib/db-types.ts
git commit -m "feat(padelgod): add hand-maintained db-types for new schema"
```

---

### Task 20: Add CI workflow

**Files:**
- Create: `.github/workflows/padelgod-ci.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
name: Padelgod CI

on:
  pull_request:
    paths:
      - 'padelgod/**'
      - '.github/workflows/padelgod-ci.yml'
  push:
    branches: [main]
    paths:
      - 'padelgod/**'

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: padelgod
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: padelgod/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/padelgod-ci.yml
git commit -m "ci(padelgod): add GitHub Actions workflow (typecheck + test)"
```

---

### Task 21: Add `padelgod/README.md`

**Files:**
- Create: `padelgod/README.md`

- [ ] **Step 1: Create README**

```markdown
# Padelgod

Padel data scraping service for PadelNachos. Sources tournaments, players, draws, OOP, and live scores from FIP/Crionet, writes directly to the shared Supabase database. Runs as a long-running Node.js service on Railway, separate from the main Next.js app.

## Getting started

```bash
cd padelgod
npm install
cp .env.example .env
# fill in real Supabase + admin token values
npm run dev
```

Visit `http://localhost:3002/health` to confirm it's up.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with file watcher (tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled build |
| `npm test` | Run vitest test suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | TypeScript check, no emit |

## Environment variables

See `.env.example`. The required ones:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — reuse from main app
- `PADELGOD_ADMIN_TOKEN` — admin API auth (generate via `openssl rand -hex 32`)

## Deployment

Railway service `padelgod` is connected to this directory. Pushing to `main` triggers an automatic build (Dockerfile-based) and deploy.

## Structure

```
src/
├── api/         # HTTP route handlers (Fastify)
├── lib/         # Shared utilities (env, logger, supabase, types)
├── workers/     # Cron + continuous workers (added in Plan 2+)
└── index.ts     # Entry point
```

## Specs

Design lives at `docs/superpowers/specs/2026-04-20-padelgod-*.md`.

## What this service does NOT do

- Doesn't replace `/relay/` yet — both run in parallel during migration
- Doesn't handle Premier `beforeauth` API calls (separate Vercel cron stays put)
- Doesn't handle app-internal crons (social drafts, editorial, quality scores) — those stay on Vercel
```

- [ ] **Step 2: Commit**

```bash
git add padelgod/README.md
git commit -m "docs(padelgod): add README with getting-started + structure"
```

---

### Task 22: Final verification + first Railway deploy

**Files:** none modified.

- [ ] **Step 1: Run full local verification**

```bash
cd padelgod
npm run typecheck
npm test
npm run build
ls -la dist/
```
Expected:
- typecheck passes
- all tests pass (10 expected: 3 env + 3 logger + 3 supabase + 1 health)
- `dist/` populated with compiled `.js` + `.js.map` files
- `dist/index.js` exists

- [ ] **Step 2: Verify migration count in Supabase**

In Supabase SQL Editor:
```sql
SELECT name FROM supabase_migrations.schema_migrations
WHERE name LIKE '20260420%' ORDER BY name;
```
Expected: exactly 11 rows (one per migration `20260420000001` … `20260420000011`).

If using CLI: `supabase migration list` shows the same 11.

- [ ] **Step 3: Push to main + watch Railway deploy**

```bash
git push origin main
```

Open Railway dashboard → padelgod service → Deployments tab. The push should trigger a build automatically. Watch the logs for:
- "Building Docker image..." → success
- "Starting container..." → no errors
- App startup logs:
  ```
  {"level":"info","service":"padelgod","time":"2026-04-20T...","url":"https://...supabase.co","msg":"Supabase client initialized"}
  {"level":"info","service":"padelgod","time":"2026-04-20T...","address":"http://0.0.0.0:3002","version":"0.1.0","msg":"padelgod listening"}
  ```

- [ ] **Step 4: Hit the deployed health endpoint**

```bash
curl -s https://padelgod.up.railway.app/health | python3 -m json.tool
```
(Substitute the actual Railway URL from your service's Settings → Domains.)

Expected:
```json
{
  "data": {
    "status": "ok",
    "uptime_seconds": <small_number>,
    "version": "0.1.0"
  }
}
```

- [ ] **Step 5: Tag the milestone**

```bash
git tag padelgod-foundation-v0.1.0
git push origin padelgod-foundation-v0.1.0
```

- [ ] **Step 6: Foundation done — write summary**

Add a short note to `docs/superpowers/plans/2026-04-20-padelgod-01-foundation.md` at the bottom (under a new "Completion log" header) with:
- Date completed
- Final commit SHA on main
- Railway deploy URL
- Any deviations from the plan that needed mid-flight fixes (so Plan 2 author knows)

---

## Definition of done

This plan is complete when **all** of the following are true:

1. ✅ `padelgod/` directory exists with full TypeScript skeleton
2. ✅ Local `npm test` passes (10 tests across env / logger / supabase / health)
3. ✅ Local `npm run build` produces a valid `dist/`
4. ✅ Local `npm run dev` starts the service and `GET /health` returns 200
5. ✅ All 11 migrations applied to Supabase, every verification block passed
6. ✅ Spot-check confirms `public_id` populated on existing rows in tournaments/players/matches/sets/games
7. ✅ Railway deploys the new `padelgod` service successfully
8. ✅ Production `GET /health` on the Railway URL returns 200
9. ✅ `relay/` service is **untouched** and still running (we did NOT break the existing pipeline)
10. ✅ Tag `padelgod-foundation-v0.1.0` exists on main

If any of the above is not true, the plan is **not done** — stop and fix before declaring completion.

---

## What this plan deliberately does NOT do

These are scope for later plans, NOT bugs to fix here:

- ❌ No workers (tournament discovery, live polling, etc.) — Plan 2+
- ❌ No admin API endpoints beyond `/health` — Plan 5
- ❌ No Playwright browser pool — Plan 2 (widget-code lookup)
- ❌ No data writes from Padelgod to canonical tables — Plan 4
- ❌ No padelapi.org migration tooling — Plan 7
- ❌ No ops dashboard tab — Plan 5

If you find yourself wanting to add any of these "while you're in there" — don't. Each scope creep weakens the test surface for the foundation.
