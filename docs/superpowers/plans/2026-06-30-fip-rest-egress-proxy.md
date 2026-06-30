# FIP REST-API Egress Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore FIP rankings + tournament-discovery on Railway by routing only the blocked WordPress REST API (`/wp-json/`) requests through a non-datacenter egress, while leaving the working front-end/admin-ajax requests on the direct connection.

**Architecture:** A single shared axios instance is created once in `padelgod/src/index.ts` and injected into every worker as `deps.httpClient`. We add an opt-in request interceptor inside `createHttpClient` that, when `FIP_PROXY_URL` is set, attaches an `HttpsProxyAgent` to any request whose URL matches `/wp-json/` (and only those). Unset env = byte-for-byte today's behavior. This fixes `player-rankings`, `tournament-discovery`, `fip-cms-orphan-prune`, and `fip-player-search` in one place with zero per-worker changes, and automatically covers any future `/wp-json/` caller.

**Tech Stack:** TypeScript, Node ≥20, axios `^1.7.7`, axios-retry, `https-proxy-agent` (new dep), vitest, tsx (local runner). Deploy target: **Railway, from `main`** (padelgod's deploy branch — NOT this worktree's branch).

---

## Background / Root cause (verified 2026-06-30)

- FIP's Cloudflare now returns **HTTP 403** (the "Attention Required" challenge page, ~50–150 ms) to padelgod's Railway egress **on the `/wp-json/` REST path only**. `padelgod.scrape_jobs`: `rankings` last succeeded Fri 2026-06-26 07:01, every tick since (Sat 06-27 + all 14 Monday 06-29 ticks) = 403; `discover` also 403 (06-30 06:35). `players.ranking_date` stuck at 2026-06-22 (week 26); week 27 never captured.
- Front-end + `admin-ajax.php` paths (`draw`, `oop`, `tournamentlive`, `match_stats`, `widget_id`, `player-profile`, entry lists) **still succeed from Railway** — these must stay on the direct client.
- Same shared client → same browser UA → same IP for both. So this is **NOT** the June User-Agent block (PR #574 is deployed and still works from a clean IP). Rotating `PADELGOD_USER_AGENT` will NOT help.
- Confirmed from a residential IP: the exact worker URL `…/es/wp-json/fip/v1/ranking/load-more/?...&week=27...` → **200 with real data** (Coello #1, 21551 pts), so week-27 data exists and the code is correct; only the egress is blocked.
- A front-end-HTML rewrite was rejected: the page server-renders only ~top-20 per list and the "load more" itself calls the same blocked `/wp-json/`; the worker needs 1,000-deep (`TOP_DEFAULT = 1000`). REST is the only data source → proxy the REST egress.

**Blocked `/wp-json/` call sites (all use the shared `deps.httpClient`):**

| File | Endpoint |
|---|---|
| `padelgod/src/workers/player-rankings.ts:64` | `/es/wp-json/fip/v1/ranking|race/load-more`, `player/search` |
| `padelgod/src/workers/tournament-discovery.ts:34-35` | `/wp-json/wp/v2/events`, `/wp-json/wp/v2/country` |
| `padelgod/src/workers/fip-cms-orphan-prune.ts:72` | `/wp-json/wp/v2/events` |
| `padelgod/src/lib/fip-player-search.ts:16` | `/wp-json/fip/v1/player/search` |

The interceptor keys on the `/wp-json/` substring, so all four are covered with no edits to these files.

---

## Phase 0: STATUS — DONE ✅ (2026-06-30)

**Provider chosen & verified: ProxyJet Rotating Residential, country Spain (ES), sticky session, HTTP protocol.** Verified from local against the week-27 canary URL: egress IP `213.37.218.75` (ES residential), rankings `/wp-json/fip/v1/...` → **200 + JSON**, discover `/wp-json/wp/v2/events` → **200**; same endpoints direct with the bot UA still **403**. Endpoint shape: `http://<user>-resi-ES-ip-<sessionId>:<pass>@eu.proxy-jet.io:1010` (the real value is a secret — set it as `FIP_PROXY_URL` in the Railway dashboard, never in the repo). Note: `axios-retry` does NOT retry 403, and the sticky session pins one IP, so if that IP is ever flagged a run fails until the session id is rotated (low risk; just regenerate the endpoint). Original Phase 0 guidance retained below for reference.

## Phase 0 (reference): Choose egress (decision gate — do this FIRST)

**Why:** the implementation is provider-agnostic (any `http(s)://user:pass@host:port` proxy URL), but we must confirm the chosen egress actually bypasses the 403 before wiring it. Cloudflare bot-management typically blocks ALL datacenter ASNs, so a free serverless/datacenter relay may also be 403'd — verify, don't assume.

**Canary URL (browser UA, no proxy from residential = 200; this is the test target):**
```
https://www.padelfip.com/es/wp-json/fip/v1/ranking/load-more/?gender=male&limit=5&offset=0&category=master&circuit=premierpadel&year=2026&week=27&lang=es
```

- [ ] **Step 1: Pick candidate(s) and get a proxy URL.** Options, cheapest-first:
  - **Residential pay-as-you-go (recommended — robust):** IPRoyal / Smartproxy / Bright Data. Our traffic is tiny (rankings full run ≈ 1–2 MB; discover < 0.5 MB; weekly + a few daily ticks ⇒ well under ~100 MB/month ⇒ ~$1/mo). Yields `http://user:pass@host:port`.
  - **Datacenter proxy in a clean ASN (cheaper, riskier):** may still be challenged by Cloudflare. Only viable if Step 2 passes.
  - **Free serverless relay (free, riskiest):** Supabase Edge Function (already in project) or Cloudflare Worker that forwards the request. Most are datacenter ASN ⇒ likely 403. Test before building.

- [ ] **Step 2: Verify the candidate bypasses the 403.**

  Proxy candidate:
  ```bash
  BROWSER="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  curl -s -o /dev/null -w "HTTP %{http_code}\n" --proxy "http://user:pass@host:port" -A "$BROWSER" \
    "https://www.padelfip.com/es/wp-json/fip/v1/ranking/load-more/?gender=male&limit=5&offset=0&category=master&circuit=premierpadel&year=2026&week=27&lang=es"
  ```
  Serverless relay candidate: deploy the throwaway forwarder, then `curl` it the same way.

  Expected: **HTTP 200** and a JSON body starting `[{"player_id":...`. If 403 → that egress is also blocked; try the next candidate. **Do not proceed to Phase 1 until one candidate returns 200.**

- [ ] **Step 3: Record the decision.** Note the chosen provider + the exact `FIP_PROXY_URL` value (store the secret in the Railway dashboard, not in the repo). This value is what Phase 2 sets on Railway.

---

## Phase 1: Build the proxy-routing seam (TDD)

### Task 1: Add `https-proxy-agent` dependency

**Files:**
- Modify: `padelgod/package.json` (dependencies)

- [ ] **Step 1: Install the dependency**

Run (from `padelgod/`):
```bash
cd padelgod && npm install https-proxy-agent@^7.0.0
```
Expected: `package.json` gains `"https-proxy-agent": "^7.0.0"` under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Commit**

```bash
git add padelgod/package.json padelgod/package-lock.json
git commit -m "build(padelgod): add https-proxy-agent for FIP REST egress proxy"
```

### Task 2: Route `/wp-json/` requests through the proxy in `createHttpClient`

**Files:**
- Modify: `padelgod/src/lib/http-client.ts`
- Test: `padelgod/src/__tests__/http-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `padelgod/src/__tests__/http-client.test.ts`:
```ts
import { HttpsProxyAgent } from 'https-proxy-agent';

describe('createHttpClient FIP REST proxy routing', () => {
  const PROXY = 'http://user:pass@proxy.example:8080';

  function requestInterceptors(client: ReturnType<typeof createHttpClient>) {
    // axios stores registered interceptors here; typed as any for test access
    return (client.interceptors.request as any).handlers.filter(Boolean);
  }

  it('adds no request interceptor when no proxyUrl is configured', () => {
    const client = createHttpClient({ userAgent: 'X' });
    expect(requestInterceptors(client).length).toBe(0);
  });

  it('routes /wp-json/ URLs through the proxy agent when proxyUrl is set', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const fulfilled = requestInterceptors(client)[0].fulfilled;
    const cfg = fulfilled({
      url: 'https://www.padelfip.com/es/wp-json/fip/v1/ranking/load-more/?gender=male',
    });
    expect(cfg.httpsAgent).toBeInstanceOf(HttpsProxyAgent);
    expect(cfg.proxy).toBe(false);
  });

  it('leaves front-end/admin-ajax URLs on the direct connection', () => {
    const client = createHttpClient({ userAgent: 'X', proxyUrl: PROXY });
    const fulfilled = requestInterceptors(client)[0].fulfilled;
    const cfg = fulfilled({
      url: 'https://www.padelfip.com/es/events/foo-p2-2026/?tab=Cuadros',
    });
    expect(cfg.httpsAgent).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `padelgod/`):
```bash
npx vitest run src/__tests__/http-client.test.ts
```
Expected: FAIL — the new `proxyUrl` option is not yet supported (no interceptor registered; `httpsAgent` undefined for the REST URL).

- [ ] **Step 3: Implement the proxy routing**

Replace the body of `padelgod/src/lib/http-client.ts` with:
```ts
import axios, { type AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * If set, requests whose URL matches `proxyPathPattern` (default: the FIP
   * WordPress REST API path `/wp-json/`) are sent through this HTTP(S) proxy.
   * All other requests use the direct connection. Defaults to
   * `process.env.FIP_PROXY_URL` so ops can set it on Railway with no redeploy
   * of this signature. Unset = direct connection for everything (today's
   * behavior). See docs/superpowers/plans/2026-06-30-fip-rest-egress-proxy.md.
   */
  proxyUrl?: string;
  proxyPathPattern?: RegExp;
}

export function createHttpClient(opts: HttpClientOptions): AxiosInstance {
  if (!opts.userAgent) throw new Error('userAgent is required');
  const client = axios.create({
    timeout: opts.timeoutMs ?? 30_000,
    headers: {
      'User-Agent': opts.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/json,*/*',
    },
    // Treat 4xx/5xx as exceptions so retries trigger
    validateStatus: (status) => status >= 200 && status < 400,
  });
  axiosRetry(client, {
    retries: opts.maxRetries ?? 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (err) =>
      axiosRetry.isNetworkOrIdempotentRequestError(err) ||
      (err.response?.status !== undefined && err.response.status >= 500),
  });

  const proxyUrl = opts.proxyUrl ?? process.env.FIP_PROXY_URL;
  if (proxyUrl) {
    const agent = new HttpsProxyAgent(proxyUrl);
    const pattern = opts.proxyPathPattern ?? /\/wp-json\//;
    client.interceptors.request.use((config) => {
      if (pattern.test(config.url ?? '')) {
        config.httpsAgent = agent;
        // Disable axios' built-in env-proxy handling so our agent is used.
        config.proxy = false;
      }
      return config;
    });
  }

  return client;
}

export const PADELGOD_USER_AGENT =
  process.env.PADELGOD_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `padelgod/`):
```bash
npx vitest run src/__tests__/http-client.test.ts
```
Expected: PASS (all original + 3 new tests).

- [ ] **Step 5: Typecheck the package**

Run (from `padelgod/`):
```bash
npm run build
```
Expected: clean TypeScript compile (no errors).

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/lib/http-client.ts padelgod/src/__tests__/http-client.test.ts
git commit -m "feat(padelgod): route FIP /wp-json/ requests through optional egress proxy"
```

> Note: `createHttpClient` already reads `process.env.FIP_PROXY_URL` as the default, mirroring the existing `PADELGOD_USER_AGENT` pattern, so `index.ts:68` needs **no change**. The shared client created there picks up the proxy automatically when the env var is present.

---

## Phase 2: Deploy & verify on Railway

### Task 3: Set the env var and redeploy

**Files:** none (Railway dashboard).

- [ ] **Step 1: Merge to `main`.** Open a PR from this branch to `main` (padelgod's deploy branch — confirmed via the Admin deploy note in memory; padelgod runs on Railway from `main`). Merge after review.

- [ ] **Step 2: Set the secret on Railway.** In the padelgod service → Variables, add `FIP_PROXY_URL = <value from Phase 0 Step 3>`. (Optional: also confirm `PADELGOD_USER_AGENT` is unset/browser — unrelated but worth a glance.)

- [ ] **Step 3: Redeploy.** Railway redeploys on the new commit + var change. **Do this when no Premier match is live** — a redeploy interrupts the live-poller (per the FIP-block memory).

- [ ] **Step 4: Verify the 403→success flip in `scrape_jobs`.** After the next `rankings` tick (Tue–Sat 07:00 UTC) or trigger a manual run, query:
  ```sql
  select job_type, status, started_at, duration_ms, error_message
  from padelgod.scrape_jobs
  where job_type in ('rankings','discover')
  order by started_at desc limit 10;
  ```
  Expected: `status='success'`, multi-second durations (full success was ~40 s for the big official runs), `error_message` empty. No more `403`.

- [ ] **Step 5: Verify data freshness.**
  ```sql
  select max(ranking_date) from players;                                   -- expect 2026-06-22 → 2026-06-29 (week 27)
  select type, year, week, count(*) from player_ranking_snapshots
  group by 1,2,3 order by year desc, week desc limit 4;                    -- expect a week-27 row
  ```

---

## Phase 3: Immediate week-27 backfill (run in parallel with Phase 0–2)

Production rankings are a week stale now; this gets week 27 live without waiting for the durable fix. Runs **locally** (residential IP reaches FIP fine — proven 2026-06-30), so it needs no proxy. This is the proven June pattern.

### Task 4: Local one-shot `player-rankings` run

**Files:**
- Create: `padelgod/scripts/run-rankings-once.ts` (throwaway; do not commit, or commit under `scripts/` if reused)

- [ ] **Step 1: Confirm local creds.** `padelgod/.env.local` (or repo `.env.local`) must have `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (writes bypass RLS). Confirm:
  ```bash
  grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_KEY)=' .env.local
  ```

- [ ] **Step 2: Write the runner.** Mirror how `index.ts` constructs deps (Supabase client + http client with the browser UA), then call `runPlayerRankings`. Adjust import paths/symbol names to match `padelgod/src` (verify `runPlayerRankings`'s exact deps shape in `padelgod/src/workers/player-rankings.ts` before running):
  ```ts
  // padelgod/scripts/run-rankings-once.ts
  import 'dotenv/config';
  import { createClient } from '@supabase/supabase-js';
  import { createHttpClient, PADELGOD_USER_AGENT } from '../src/lib/http-client.js';
  import { runPlayerRankings } from '../src/workers/player-rankings.js';

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );
  const httpClient = createHttpClient({ userAgent: PADELGOD_USER_AGENT }); // local IP → no proxy needed

  const logger = console as any; // minimal logger shim; swap for pino if the worker requires it
  await runPlayerRankings({ supabase, httpClient, logger });
  console.log('done');
  ```

- [ ] **Step 3: Run it.**
  ```bash
  cd padelgod && npx tsx scripts/run-rankings-once.ts
  ```
  Expected: completes in ~3 min, logs success for official + race × men/women, writes ~2.3k snapshots (June reference: 2269 snapshots, ~176 s).

- [ ] **Step 4: Verify in DB** (same queries as Phase 2 Step 5). Expect `players.ranking_date = 2026-06-29` and a week-27 snapshot row. The home/rankings "FIP Rankings" tile should flip green.

---

## Self-Review notes

- **Spec coverage:** durable fix = Phase 1 (seam) + Phase 2 (deploy) covers `rankings` + `discover` + `fip-cms-orphan-prune` + `fip-player-search` via the shared-client interceptor; immediate stopgap = Phase 3 backfill; egress feasibility de-risked = Phase 0 gate.
- **No per-worker edits:** the interceptor keys on the `/wp-json/` URL substring, and every blocked caller already uses the single shared `deps.httpClient`, so no worker file changes are required. Front-end/admin-ajax URLs (no `/wp-json/`) are untouched.
- **Safe rollout:** behavior is identical to today when `FIP_PROXY_URL` is unset; the env var is the only switch.
- **Verify-before-claim:** Phase 0 Step 2 and Phase 2 Step 4 are hard gates with expected HTTP/DB output — don't mark complete on assumption.
- **Open item:** if Phase 0 finds that even residential proxies get challenged (unlikely), escalate to a headless-browser fetch (the project already has `playwright-pool.ts`) for the REST endpoints — out of scope here, note as fallback.
