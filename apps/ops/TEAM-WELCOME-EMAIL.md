# Team welcome email

A transactional welcome is sent after a new active grant or restoration commits successfully. Active role changes, suspensions and rejected requests do not send welcomes. Sign-in still requires the existing verified identity checks; the email contains a normal login URL, not an authentication token.

The email matches the admin branding with a dark dual-logo header, lime CTA and coral accent. Viewer, Scouter and Administrator variants describe their actual permissions. It includes HTML and plain text, the exact sign-in email and Google/email-link instructions. Scouters are directed to obtain the extension from their administrator and practise in Playground.

Uses the existing RESEND_API_KEY and AUTH_EMAIL_FROM configuration. Provider rejection/missing configuration returns a visible delivery warning while preserving the access grant. No existing members receive a backfill email. Delivery acceptance is not a receipt/read guarantee.

Validation: 28 access/email tests passed with mocked delivery; production webpack build and TypeScript passed; desktop and 390px browser previews reviewed. No real emails were sent and no access was changed.

## Magic-link delivery checks

Admin login now checks the provider’s error response and message ID, and only proceeds to Auth.js’s verification page on an accepted email request. Failures remain in the email form with a retry/Google message. Safe diagnostic categories exclude recipients, authentication URLs, tokens and provider response bodies. Plain-text sign-in instructions accompany HTML. A provider-accepted message is not proof of inbox delivery.
