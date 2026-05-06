# Padel Labs v1 — Data & Content Engine for Padel Creators

**Status:** Design (proposed)
**Author:** Claude (with @GuDenes brainstorming session 2026-05-06)
**Pillar:** This is sub-project **E** of Pillar 3 in the broader Padel growth strategy (B2B/prosumer platform on top of the Padel Nachos data foundation). Sibling sub-projects (A widgets, B public REST API, C packaged data feeds, D media tools) are explicitly **not** in scope for this spec.

## 1. Goal

Productize the data Padel Nachos already collects (live scores, match stats, draws, players, tournaments) for **padel content creators** — Twitter/X analysts, YouTubers/podcasters, and academy coaches — through a self-serve, prosumer SaaS at `padellabs.tech`.

The product gives creators three input modes over a single grounded answer engine:

- **Ask** — multi-turn chat, cited answers, live padel data
- **Templates** — pre-built creator workflows producing branded, shareable outputs
- **Browse** — saved queries and conversation history

The chat is the magic moment. The data, citations, branded outputs, and templates are the moat — that's what ChatGPT/Claude/Perplexity cannot replicate.

## 2. Out of scope (v1)

These were considered and explicitly deferred:

- **Embeddable widgets for federation sites** (Pillar 3 sub-project A) — wrong audience for this product. Defer indefinitely or to a separate spec.
- **Public REST API with key management** — internal `POST /api/v1/ask` powers v1 surfaces but is not publicly documented or sold. Productize as "Power tier" in v2 once paying users pull for it.
- **Scheduled / recurring reports** ("every Monday 9am, generate this week's upsets card") — strong differentiator but ships in **v1.5**, not v1. Adds a job-runner subsystem we don't need to validate the core thesis.
- **News / quote synthesis (capability C8)** — requires embedding-based RAG over `articles`. Defer to v1.5.
- **Predictions / forecasts (C9)** — no model exists.
- **Shot-pattern / rally analysis (C10)** — no shot-level data in the schema.
- **Charts & PDF reports** as output formats — defer to v2. v1 outputs are tables, branded PNG cards, CSV/JSON.
- **AI image generation for cards** — explicitly rejected. Use Satori/Resvg deterministic rendering. Never DALL-E / Midjourney / Imagen for stat cards.
- **Mobile app** — responsive web only.
- **Padel Nachos consumer integration** of the chatbot — Labs-only for v1. Revisit later.
- **Long-form synthesis / season recaps** — defer to v2 or D-pillar (storytelling tools).

## 3. Audience & differentiation

### 3.1 Audience

- **A** — Twitter/X padel analysts (independent voices, ~5–50k followers, post analysis threads)
- **B** — Padel YouTubers / podcasters (use data as raw material for video and audio content)
- **C** — Academy coaches (data-driven scouting and training content)

Common thread: they all turn data into content. Output formats matter as much as answers.

### 3.2 Defensibility vs ChatGPT / Claude / Perplexity

| Capability | General LLM tools | **Padel Labs** |
|---|---|---|
| Live, real-time padel data | ❌ Frozen at training cutoff | ✅ Pusher relay → live scores |
| Comprehensive padel corpus | 🟡 Shallow / patchy | ✅ 6,500+ matches, per-set stats, draws, OOP |
| Citations / source-of-truth | ❌ Hallucinates with confidence | ✅ Every answer cites table + match ID + timestamp |
| FIP draws / Premier stats / Crionet widgets | ❌ Not scrapable | ✅ Uniquely aggregated |
| Branded shareable PNG outputs | ❌ AI image gen ≠ designed cards | ✅ Satori-rendered, watermarked, tweet-ready |
| Reproducible / scheduled workflows | ❌ One-off conversations | 🟡 v1.5 (saved queries v1, scheduling v1.5) |
| Domain-aware UX | 🟡 Generic | ✅ Padel-aware (draws, brackets, no-ad, court ordering) |

The chat alone is commodity. The chat + data + outputs + workflow templates is the product.

## 4. Brand & topology

- **Padel Labs** as the parent brand (the "data company"); Padel Nachos remains the consumer-facing product. Mental model:

  ```
        Padel Labs (the data + AI infra)
        ├── padelnachos.com   → consumer fan app  (B2C)
        └── padellabs.tech    → APIs + chat + templates (B2B / prosumer)
  ```

- **Domains:**
  - `padellabs.tech` — marketing site + public demo chat (IP-throttled, no auth)
  - `app.padellabs.tech` — authenticated workspace (the actual product)
  - `api.padellabs.tech` — internal API host (powers both surfaces; not publicly documented in v1)
  - `cdn.padellabs.tech` — image / static assets (deferred until needed)
  - `docs.padellabs.tech` — deferred to v2

- **Repo:** stays in the existing `padel-live-scores` monorepo. New folder `apps/labs/` for the Next.js 16 app. **Do not fork.** Shared types via `../../src/lib/...` initially; extract `packages/` later when reuse pressure warrants it.

- **Deploy:** new Vercel project, Root Directory = `apps/labs/`, custom domains for `padellabs.tech` + subdomains.

- **Database:** shares the existing `padel-live-scores` Supabase project. Reads from the same `matches` / `players` / `tournaments` / `match_stats` / `tournament_draws` tables Padel Nachos and Padelgod populate. **No data duplication.**

## 5. v1 capability scope

Capabilities the chat + templates can answer in v1, mapped to existing data:

| # | Capability | v1? | Source | Notes |
|---|---|---|---|---|
| C1 | Match facts & schedules | ✅ | `matches` | Live + historical |
| C2 | Player profiles | ✅ | `players` + joined `match_stats` | |
| C3 | Head-to-head | ✅ | derivable from `matches` | The single most-asked sports question |
| C5 | Aggregate season stats | ✅ | derivable | Filter by gender, surface, year |
| C6 | Match-level statistics | ✅ | `match_stats` | First-serve %, breakpoints, etc. |
| C7 | Tournament info | ✅ | `tournaments` + `tournament_draws` | Including draw / OOP / champions |
| C4 | Rankings / race history | 🟡 v1.5 | `players.ranking` (current) — verify history table exists for movement queries |
| C8 | News & quote synthesis | 🟡 v1.5 | `articles` — needs embeddings RAG |
| C9 | Predictions / forecasts | ❌ | no model | |
| C10 | Shot-pattern analysis | ❌ | no shot-level data | |

**Out-of-scope queries** receive a polite refusal that lists what we *can* answer (anti-frustration UX).

## 6. v1 surfaces

### 6.1 Public marketing site at `padellabs.tech`

- Hero showcases **templates as the demo** (visible polished outputs) with chat one click away
- Pricing page, About, Privacy
- Public demo chat embedded on homepage — IP-rate-limited (e.g. 5 questions per IP per day, no auth required)
- Marketing positioning: *"The data engine for padel content creators — chat with the numbers, ship branded cards in seconds."* (NOT "AI chatbot for padel.")

### 6.2 Authenticated workspace at `app.padellabs.tech`

Sidebar layout:

- **Ask** — multi-turn chat with persistent conversation history
- **Templates** — gallery of pre-built workflows; clicking one opens a parameterized runner (e.g. *Match Preview Card* → pick match → render → download/share)
- **Browse** — saved queries + chat history, searchable
- **Settings** — profile, billing, locale

### 6.3 Output formats v1

- **Tables** — rendered in chat, copyable
- **Branded PNG cards** — server-rendered via Satori/Resvg, watermarked "Powered by Padel Labs", tweet/IG-ready dimensions
- **CSV / JSON download** — for power users who want to pivot data in their own tools

Charts and PDFs deferred to v2.

## 7. Pricing & free tier

| Tier | Price (v1) | Daily queries | Templates | PNG cards | CSV/JSON export | History |
|---|---|---|---|---|---|---|
| **Free** | $0 | 10 / day | ❌ | ❌ | ❌ | last 7 days |
| **Pro** | TBD ($20–40/mo target) | 100 / day | ✅ | ✅ | ✅ | unlimited |
| **Power (v2)** | TBD | 1,000+ / day | ✅ | ✅ | ✅ + API key | unlimited |

Public-demo chat (homepage, no auth) is IP-throttled at ~5 questions per IP per day — strictly a marketing top-of-funnel surface, not a free-product replacement.

Stripe Checkout for Pro upgrade. Webhook syncs subscription state to `labs_subscriptions`.

## 8. Localization

Ship all 5 locales at v1 launch — `en` (default), `es`, `pt`, `it`, `fr` — to match Padel Nachos and serve the multilingual padel-creator audience.

| Layer | Approach |
|---|---|
| UI chrome | next-intl + `src/messages/{locale}.json` per locale, mirroring nachos's structure. Reuse keys where they overlap. |
| Marketing site | Authored per-locale (~1 week one-time content effort). |
| Chat answers | Claude responds in the user's locale; instructed via system prompt directive `Respond in {user_locale}`. Slight output-token bump (~10–15%) in Romance languages — negligible. |
| Templates | SQL/data layer is language-agnostic. Surface text (titles, captions, labels) lives in i18n bundles. Author once with i18n keys, not 5 versions. |
| PNG cards | Satori/Resvg pipeline reads locale at render time. Player/tournament names = universal. Round names, captions, watermarks = i18n bundle. |
| Padel glossary | Curated dictionary (round names, set/game/break terminology, jargon like *bandeja* / *víbora* / *contrapared*) used both by the i18n bundle AND fed into the system prompt so the model uses the *right* terms per locale. |
| Per-locale QA | Sample-question batches in each locale, native-speaker spot-check before launch. |

**Principle:** locale is a layer over the same engine, not five forked products.

## 9. Architecture

### 9.1 Component layout

```
apps/labs/
├── src/app/
│   ├── (marketing)/
│   │   ├── page.tsx                # Homepage with public demo chat
│   │   ├── pricing/
│   │   ├── about/
│   │   └── ...
│   ├── (app)/                      # auth-required workspace
│   │   ├── layout.tsx              # auth gate, sidebar
│   │   ├── ask/                    # main chat surface
│   │   ├── templates/
│   │   │   ├── page.tsx            # template gallery
│   │   │   └── [slug]/             # individual template runner
│   │   ├── browse/                 # saved queries + history
│   │   └── settings/               # billing, profile
│   ├── api/
│   │   ├── v1/
│   │   │   ├── ask/route.ts        # core endpoint — both demo + workspace
│   │   │   ├── template/[slug]/    # template execution
│   │   │   ├── render-card/        # PNG card generation (Satori)
│   │   │   └── export/             # CSV/JSON downloads
│   │   ├── stripe/webhook/         # subscription state sync
│   │   └── auth/                   # Auth.js endpoints
│   └── ...
├── src/lib/
│   ├── ai/
│   │   ├── classifier.ts           # Haiku pre-classifier
│   │   ├── system-prompt.ts        # cached system prompt builder
│   │   ├── tools.ts                # tool defs: query_matches, query_players, etc.
│   │   ├── glossary.ts             # padel multi-language terms
│   │   └── cache.ts                # output cache
│   ├── data/
│   │   ├── queries.ts              # named SQL queries (parameterized, safe)
│   │   ├── h2h.ts                  # H2H aggregator
│   │   ├── season-stats.ts         # season aggregations
│   │   └── ...
│   ├── render/
│   │   ├── card.tsx                # Satori card components
│   │   └── render-png.ts           # HTML → PNG
│   ├── templates/
│   │   ├── registry.ts             # template definitions
│   │   ├── daily-recap.ts
│   │   ├── match-preview.ts
│   │   ├── scouting-onepager.ts
│   │   └── ...
│   ├── billing/                    # Stripe helpers
│   ├── auth.ts                     # Auth.js v5 config
│   └── usage.ts                    # rate-limit + metering
└── src/messages/                   # i18n bundles (en/es/pt/it/fr)
```

### 9.2 Data model — new tables

All Labs-specific data lives in tables prefixed `labs_*` (separate concern from public data):

| Table | Purpose | Notes |
|---|---|---|
| `users` / `sessions` / `accounts` | Auth.js v5 standard tables (verify schema choice with nachos's setup) | mirrors nachos pattern |
| `labs_subscriptions` | Stripe subscription state per user | tier, status, renewal, stripe_customer_id, stripe_subscription_id, current_period_end |
| `labs_conversations` | Chat session container per user | created_at, title, locale |
| `labs_messages` | Individual chat turns | role (user/assistant), content, citations[], cost_tokens |
| `labs_saved_queries` | User-saved questions for re-running | text, params, last_run_at |
| `labs_usage_events` | Per-question metering for rate limits + analytics | user_id (or ip), kind (chat/template/export), at, cost_units |
| `labs_template_runs` | Template execution log | template_slug, params, output_kind, at |

`labs_conversations` and `labs_messages` use Supabase RLS so users see only their own data.

### 9.3 Request flow (Ask)

```
1. Client → POST /api/v1/ask  { question, locale, conversation_id? }
2. Auth: validate session OR check IP rate-limit (demo)
3. Usage gate: enforce per-tier daily quota (free 10, pro 100)
4. Output cache lookup
   key = hash(normalized_question + locale + today_utc + user_tier)
   ├─ HIT  → return cached answer, no LLM call
   └─ MISS → continue
5. Pre-classifier (Haiku 4.5, ~50 tokens) → { intent, confidence }
   ├─ template       → run deterministic template → render output → return
   ├─ lookup         → tool-use Haiku 4.5 with tight schema
   ├─ reasoning      → Haiku 4.5 with full tool set; escalate to Sonnet 4.6 only if Haiku tool-loops > N
   └─ out_of_scope   → polite refusal listing in-scope topics
6. Tool calls fan out to data/queries.ts (parameterized SQL, safe)
7. Stream response to client; collect citations
8. Persist message + usage event (async, non-blocking)
9. Cache the answer with tier-appropriate TTL
   - Live-data answers: 60s
   - Aggregate answers: 1 hour
   - Static answers (e.g., player profile): 24 hours
```

### 9.4 Cost model

| Tier | Trigger | LLM cost | Target share |
|---|---|---|---|
| **Tier 0** — templates / cache / saved | classifier matched template OR cache hit | $0 | ~70% |
| **Tier 1** — Haiku 4.5 + prompt cache + tool use | classifier=lookup OR simple reasoning | ~$0.004 / query | ~25% |
| **Tier 2** — Sonnet 4.6 escalation | Haiku tool-loop limit exceeded OR classifier=complex | ~$0.015 / query | ~5% |

**Effective per-query average:** ~$0.0014. At 100 queries/day for a Pro user → ~$0.14/day = **~$4/mo cost vs $20–40 ARR. Margin >85%.**

PNG cards: Satori/Resvg, ~50ms server-side, deterministic, free per render.

Scheduled outputs (v1.5+): Anthropic batch API, 50% discount.

### 9.5 Auth, billing, rate-limiting

- **Auth.js v5**, mirroring nachos pattern. Magic-link email primary; OAuth (Google, Apple) optional.
- **Stripe Checkout** for Pro upgrade. Webhook (`/api/stripe/webhook`) syncs `labs_subscriptions`.
- **Rate-limiting**: per-user daily counter in `labs_usage_events`. Free=10/day, Pro=100/day. Public demo IP-based (5/day). All limits checked at the route handler before any LLM call.
- **Per-tier feature gates**: middleware checks subscription tier before serving template/card/export endpoints.

## 10. Error handling

| Failure | Behavior |
|---|---|
| Tool/SQL failure | Graceful degraded answer: *"I couldn't fetch live stats — showing cached data from {timestamp}"* |
| LLM timeout | One retry with smaller context; then user-friendly error |
| Rate-limit hit | Friendly upsell: *"You've hit today's free limit — upgrade or wait until tomorrow"* with CTA |
| Out-of-scope question | Polite refusal listing example in-scope queries |
| Hallucination guard | If model produces a stat without a tool-result citation, **show a banner flagging uncertainty** rather than hide it. Trust through transparency. |
| Stripe webhook failure | Log + retry; surface stale-subscription banner if state is more than N hours old |
| Tool-loop limit (Haiku unable to converge) | Escalate to Sonnet once; if that also fails, return *"I couldn't find a clear answer — could you rephrase?"* |

## 11. Testing

- **Unit:** `data/queries.ts` (SQL correctness), `templates/*` (output shape), `render/card.tsx` (snapshot test PNGs per locale).
- **Integration:** end-to-end `POST /api/v1/ask` against fixture DB, verifying tool-call paths, citations, locale handling, rate-limit enforcement.
- **LLM eval suite:** ~50 canonical questions per locale stored as YAML; runs nightly against the latest model and measures (a) factual accuracy via DB-grounded check, (b) citation present and verifiable, (c) locale correctness, (d) token cost. Eval suite is a **first-class artifact** — failing evals block deploys.
- **Cost telemetry:** log tokens-per-request, tier-routing distribution, cache hit rate. Alarm if cost-per-query drifts >2× baseline.
- **Hallucination probes:** small set of intentionally adversarial questions ("did Tapia win Madrid 2027?" — future event) that should produce honest "I don't know" responses, not invented answers.

## 12. Success metrics

For deciding whether v1 worked and what to ship next:

| Metric | Target after 90 days post-launch |
|---|---|
| Free signups | 500+ |
| Free → Pro conversion | ≥4% |
| Paying users | 20+ |
| MRR | $400+ |
| Cost-per-query (effective) | < $0.002 |
| Cache hit rate | > 30% |
| Template execution share of total usage | > 30% |
| LLM eval pass rate | > 95% per locale |

Below targets at 90 days = revisit positioning, audience, or scope. Above targets = unlock v1.5 (scheduled reports + News RAG + rankings history).

## 13. Open decisions deferred

These are explicitly marked as TBD and resolved during implementation, not blockers for the spec:

- **Pro tier exact price** — set by user after market check ($20–40/mo target range)
- **Pro tier daily query cap** — start at 100/day, adjust based on actual usage distributions
- **Auth providers beyond magic-link** — start with magic-link only; add Google/Apple OAuth if signup conversion data warrants
- **Initial template set** — minimum 3, maximum 5 for v1 launch. Candidates: *Match Preview Card*, *Player H2H Card*, *Top Movers This Week*, *Daily Recap Thread Generator*, *Scouting One-Pager*. Pick during planning.
- **Domain registrar / DNS provider** — `padellabs.tech` ownership and DNS setup is outside this spec
- **CDN strategy** — defer until PNG generation hits a latency bottleneck

## 14. References

- Brainstorming session: this conversation, 2026-05-06
- Pillar 3 strategy framing: same conversation, sections 1–4
- Existing data foundation: [`CLAUDE.md`](../../../CLAUDE.md), padelgod workers, padelapi.org integrations
- Sibling Pillar-3 sub-projects (deferred): widgets, public API, packaged feeds, media tools (D)
- Implementation plan: to be written next via the writing-plans skill
