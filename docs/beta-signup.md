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

The form records name, email, optional WhatsApp number, preferred interview language, page language,
participation commitment, email contact consent, copy version, and signup time.
New signups receive a confirmation through Resend in their preferred interview
language (English, Spanish, or Portuguese). The message confirms the October 10
start and tells them to expect access instructions by email. HTML and plain-text
versions live in `src/lib/email/beta-confirmation.ts`. Sending uses the existing
`RESEND_API_KEY` and `AUTH_EMAIL_FROM` settings. Duplicate submissions do not
resend. Delivery failures are logged without undoing the registration; Resend
messages are tagged `campaign=prediction-beta` for tracking. There is no
automatic retry or backfill for existing signups.

It does not create a game account. The October 10 access email, interview
scheduling, and rewards are handled by the team separately.

The participant reward is an exclusive in-game badge plus one year of Pro,
with eligibility to win real prizes. Edit `src/lib/beta-copy.ts` to update the
dates or reward details.
If the consent wording changes, also update the API's `consent_version`.

## Verification

`npx vitest run src/app/api/beta/signup/__tests__/route.test.ts`

`npx eslint 'src/app/[locale]/beta' src/app/api/beta src/lib/beta-copy.ts`

## Campaign dates

The beta starts October 10, 2026 (Europe/Madrid). Signups close October 7,
2026 at 23:59:59 Europe/Madrid (21:59:59 UTC); the campaign was extended from
October 2.
Both the countdown and API use `src/lib/beta-schedule.ts`. At the deadline,
the form switches to a closed state and the API refuses new submissions.
The market image is the supplied design reference, labelled as sample data.

## App invitation

The localized beta invitation appears once per browser or native app installation,
after cookie consent and other modal dialogs are dismissed. It does not interrupt
beta signup, onboarding, legal, or support pages. An actual impression or successful
signup is remembered in local storage; this is not synchronized across accounts or
devices. Blocked storage falls back to memory for the current page session. The
invitation automatically stops at the campaign signup deadline.

## WhatsApp and app downloads

Apply `supabase/migrations/20260929000000_prediction_beta_whatsapp.sql` before
releasing the updated API. Applied to production on September 29, 2026.
WhatsApp numbers are optional, require a country code,
and are stored in international format without spaces or punctuation. Consent
version `2026-09-29` covers email and WhatsApp when a number is supplied. Existing
registrations keep their original details and consent; duplicate submissions do
not add or replace a number. WhatsApp messages are handled by the team separately.

The signup card and confirmation state include links to the existing iOS and
Android apps. Downloading the app is optional; beta access instructions still
arrive by email.
