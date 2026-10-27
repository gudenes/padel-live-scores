# Viewer video review notes

Viewer, Scouter and Administrator accounts can open a saved match report → Video review → Team review notes. Connect a video, use the current playback time (or enter mm:ss / hh:mm:ss), choose Note, Highlight, Question or Needs review, and save a comment. Leave the timestamp blank for a general match note. Notes are shared with the scouting team; each author can remove their own notes. Public shared reports do not include team notes.

Review annotations live exclusively in `public.scouting_review_notes`. The API does not update session documents, scores, point events, or statistics. Canonical and private matches use separate foreign keys; author identity comes from the current authenticated session. Existing browser-only bookmarks remain personal bookmarks.

## Release

Apply `supabase/migrations/20261027120000_scouting_review_notes.sql` before deploying the admin app. This adds a new RLS-protected table without changing existing scouting records. No production migration or deployment was performed as part of implementation.

After deployment, verify with a Viewer account: save a timestamped note, reopen the report, play its timestamp, and remove the note. Check another team member can see it but cannot remove it. Confirm scouting save endpoints remain denied. Check a private match and a public shared report as well.

Rollback the application if necessary; retain the additive table to preserve notes.
