# Padel Labs — Railway + Cloudflare cutover

Same pattern as `padelnachos.com`: origins on Railway (`hearty-charm`, EU West), Cloudflare as public DNS/CDN/WAF. Vercel projects stay paused as rollback for a few days.

`padellabs.tech` is **two** origins sharing one zone:

| Hostname | Origin | Source |
|---|---|---|
| `padellabs.tech` / `www` | Railway `padel-labs-site` | repo `gudenes/padellabs-site` (static `public/`) |
| `analyst.padellabs.tech` | Railway `padel-labs` | `apps/labs/` in `padel-live-scores` (Next.js chat) |

`padelboard.padellabs.tech` / `contact.padellabs.tech` stay on the `padelboard` Vercel project until that repo is cut over separately.

## Architecture

| Piece | Where |
|---|---|
| Marketing origin | Railway service `padel-labs-site` in `hearty-charm` |
| Analyst origin | Railway service `padel-labs` (`apps/labs/`, own `railway.toml`) |
| Healthcheck (analyst) | `GET /api/health` → `{ ok: true }` |
| Public edge | Cloudflare zone `padellabs.tech`, SSL **Full (strict)** |
| Custom domains | apex/`www` → `padel-labs-site`; `analyst` → `padel-labs` |

## Environment variables (Production)

Copied from the Vercel `padel-labs` project / local `apps/labs/.env.local`. Do **not** reuse Nachos `AUTH_SECRET`.

| Key | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as Nachos |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as Nachos |
| `SUPABASE_SERVICE_KEY` | Same as Nachos |
| `DATABASE_URL` | Supabase pooler URI |
| `AUTH_SECRET` | Labs-specific |
| `AUTH_URL` | `https://padellabs.tech` |
| `AUTH_TRUST_HOST` | `true` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Labs OAuth client |
| `RESEND_API_KEY` | Same as Nachos |
| `AUTH_EMAIL_FROM` | `Padel Labs <hello@padellabs.tech>` |
| `ANTHROPIC_API_KEY` | Chat engine |
| `PG_POOL_MAX` | `8` (optional; auto-detected on Railway) |

## Cutover

Vercel is the **registrar** (Name.com backend) and still holds the nameservers. The Vercel team is fair-use blocked (projects 402, DNS API 402), so nameservers must move to Cloudflare — same as `padelnachos.com`.

1. Origins already live:
   - Marketing: `https://padel-labs-site-production.up.railway.app`
   - Analyst: `https://padel-labs-production.up.railway.app/api/health` → `{ ok: true }`
2. Cloudflare dashboard → **Add a site** → `padellabs.tech` → Free plan. Copy the two assigned nameservers.
3. Vercel → Domains → `padellabs.tech` → Nameservers → replace `ns1/ns2.vercel-dns.com` with the Cloudflare pair. (If the Vercel UI is also blocked, change NS at Name.com.)
4. Wait until the Cloudflare zone is **Active**.
5. Create these DNS records (proxied = orange cloud except TXT/MX):

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` | `is5ooioh.up.railway.app` | Proxied |
| CNAME | `www` | `iws53jvl.up.railway.app` | Proxied |
| CNAME | `analyst` | `smnpdl88.up.railway.app` | Proxied |
| TXT | `_railway-verify` | `railway-verify=aac0b1cc772c3006b9e02281afb5b07f74bc3d6ab065d2a6663efc7dba1f5b88` | DNS only |
| TXT | `_railway-verify.www` | `railway-verify=5e8da6c0d003ddfcb0ddc65d767b44bef4f1f6bb21d08a577465afe4376497ec` | DNS only |
| TXT | `_railway-verify.analyst` | `railway-verify=59ce492a860e778de568a4770949fc650545a3b11b3062c255de7bcf56b1441e` | DNS only |

Also copy mail records from Vercel DNS before NS change (Resend DKIM/SPF, Infomaniak + IONOS MX, `autoconfig`/`autodiscover`). SSL/TLS = **Full (strict)**.

6. Google OAuth: add `https://analyst.padellabs.tech/api/auth/callback/google`.
7. Soak 48–72h. Rollback = NS back to `ns1.vercel-dns.com` / `ns2.vercel-dns.com`.

## Smoke

```bash
curl -sS https://padellabs.tech/api/health
# {"ok":true}

curl -sSI https://padellabs.tech | grep -iE 'server|x-railway|cf-ray|HTTP/'
# server: cloudflare
# x-railway-edge: ...
```

Then: landing `/`, `/login`, magic-link or Google, `/ask` after sign-in.

## Redeploy

From `apps/labs/`:

```bash
railway up --project ec638a56-c42f-4fa6-9216-dcd7668e34b7 \
  --environment production \
  --service padel-labs \
  --path-as-root \
  --detach -m "padel-labs: <summary>"
```

Watch paths should be `apps/labs/**` so Nachos-only commits do not rebuild Labs.
