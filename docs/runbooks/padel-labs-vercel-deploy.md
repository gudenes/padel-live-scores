# Padel Labs — Vercel + DNS deployment runbook

One-time setup to get `apps/labs/` deployed at `padellabs.tech`. Re-deploys after this happen automatically on push to `main`.

## 1. Domain registration

If `padellabs.tech` is not yet registered:
- Register through your preferred registrar (Cloudflare, Namecheap, etc.)
- Set the auth code aside; you may need it later if changing registrars.

## 2. Vercel project

1. In Vercel dashboard → "Add New" → "Project"
2. Select the `padel-live-scores` repository
3. **Critical:** in "Configure Project" → "Root Directory" → click Edit → enter `apps/labs`
4. Framework preset: **Next.js** (auto-detected)
5. Build command: leave default (`next build`)
6. Output directory: leave default (`.next`)
7. Install command: leave default (`npm install`)
8. Environment Variables (mark all as Production + Preview + Development):

   | Key | Source |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Same as Padel Nachos |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as Padel Nachos |
   | `SUPABASE_SERVICE_KEY` | Same as Padel Nachos |
   | `DATABASE_URL` | Supabase project → Settings → Database → Connection string (URI) |
   | `AUTH_SECRET` | `openssl rand -base64 32` (new value, do NOT reuse Nachos's) |
   | `AUTH_URL` | `https://analyst.padellabs.tech` (production); leave Preview as Vercel default |
   | `AUTH_GOOGLE_ID` | New OAuth client (see step 3) |
   | `AUTH_GOOGLE_SECRET` | New OAuth client (see step 3) |
   | `RESEND_API_KEY` | Same as Padel Nachos |
   | `AUTH_EMAIL_FROM` | `Padel Labs <hello@padellabs.tech>` |

9. Click "Deploy"

## 3. Google OAuth client

1. Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID
2. Application type: Web application
3. Name: `Padel Labs`
4. Authorized JavaScript origins:
   - `https://analyst.padellabs.tech`
   - `http://localhost:3003`
5. Authorized redirect URIs:
   - `https://analyst.padellabs.tech/api/auth/callback/google`
   - `http://localhost:3003/api/auth/callback/google`
6. Save → copy Client ID + Client secret into Vercel env vars

## 4. DNS

In your registrar's DNS panel, add:

| Host | Type | Value | Notes |
|---|---|---|---|
| `padellabs.tech` (apex) | A | `76.76.21.21` | Vercel apex IP |
| `www` | CNAME | `cname.vercel-dns.com` |  |
| `analyst` | CNAME | `cname.vercel-dns.com` | for analyst.padellabs.tech (the chat module) |
| `api` | CNAME | `cname.vercel-dns.com` | reserved (used in Phase 2+) |
| Resend domain verification records | TXT/MX | (Resend dashboard) | needed before sending magic-links from `@padellabs.tech` |

In Vercel → Project → Settings → Domains:
- Add `padellabs.tech` (apex) → set as primary
- Add `analyst.padellabs.tech`
- Add `api.padellabs.tech` (reserved)

Wait for DNS propagation + TLS issuance (a few minutes).

## 5. Resend domain verification

1. Resend dashboard → Domains → Add Domain → `padellabs.tech`
2. Add the TXT/MX records to your registrar
3. Verify in Resend
4. Once verified, the `AUTH_EMAIL_FROM` value will deliver successfully

## 6. Smoke test production

1. Visit `https://padellabs.tech` → see landing page
2. Click "Sign in" → routed to `/login`
3. Sign in with Google or magic-link
4. Should redirect to `https://analyst.padellabs.tech/ask`
5. Type a test question → see Phase 1 stub response

## 7. Subdomain routing note

Vercel automatically serves both `padellabs.tech` and `analyst.padellabs.tech` from the same Next.js project; routing is by path within the app (homepage at `/`, app at `/(app)/*`). If you later want stricter separation, add Vercel "Production Branches" + a second Vercel project pointing at the same Root Directory but with different env vars. **Defer to Phase 5.**
