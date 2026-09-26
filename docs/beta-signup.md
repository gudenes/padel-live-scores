# Prediction beta signup

Public pages: `/beta` (English), `/es/beta` (Spanish), `/pt/beta` (Portuguese).
The language switcher follows the site's existing locale routing. The interview
language is recorded separately so participants can choose their preference.

## Release setup

Apply `supabase/migrations/20260925000000_prediction_beta_signups.sql` to the
target Supabase database before deploying the page. The API uses the existing
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_KEY` environment variables.
The production signup migration was applied on September 25, 2026.
Deployment uses the existing Railway `padelnachos` service.

Signups are stored in `public.prediction_beta_signups`. The table is private;
anonymous and signed-in browser clients cannot read or write it directly.
Authorized operators can review/export participants through the Supabase dashboard.
Duplicate email submissions succeed without changing the original signup.

The form records name, email, preferred interview language, page language,
participation commitment, email contact consent, copy version, and signup time.
It does not create a game account or send email automatically. Beta access,
interview scheduling, and rewards are handled by the team after signup.

The participant reward is an exclusive in-game badge plus one year of Pro,
with eligibility to win real prizes. Edit `src/lib/beta-copy.ts` to update the
dates or reward details.
If the consent wording changes, also update the API's `consent_version`.

## Verification

`npx vitest run src/app/api/beta/signup/__tests__/route.test.ts`

`npx eslint 'src/app/[locale]/beta' src/app/api/beta src/lib/beta-copy.ts`

## Campaign dates

The beta starts October 10, 2026 (Europe/Madrid). Signups close October 2,
2026 at 09:43:57 UTC, seven days after the campaign countdown was requested.
Both the countdown and API use `src/lib/beta-schedule.ts`. At the deadline,
the form switches to a closed state and the API refuses new submissions.
The market image is the supplied design reference, labelled as sample data.
