# Android Release Runbook — 1.0.4 (versionCode 5)

**Trigger:** [PR #462](https://github.com/gudenes/padel-live-scores/pull/462) merged to main.

**Why this release matters:** The PR adds `capacitor-native-settings` (an Android Gradle plugin) for the "Open device settings" deep-link from the redesigned notification settings page and the bookmark nudge sheet. Without a new AAB, users on the current Play Store build (versionCode 4) get the placeholder behavior — the button logs a warning instead of opening Android Settings.

The rest of the redesign (Settings page rewrite, bookmark nudge, save feedback, mute, sounds row) ships via Vercel and reaches all users immediately. Only the deep-link buttons need this AAB.

---

## 1. Build the AAB

After PR #462 is merged:

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git checkout main && git pull
cd android
./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

**Expected build time:** ~2-3 minutes on a clean cache.

**If build fails:**
- Most common cause: `capacitor.settings.gradle` missing the `:capacitor-native-settings` line. Run `cd .. && npx cap sync android` from the repo root, then retry the gradle build.
- Second most common: keystore/signing config mismatch. Check `android/app/build.gradle` — `signingConfigs.release` should reference `RELEASE_KEYSTORE_PATH` and other env vars set per repo `README.md`.

---

## 2. Upload to Play Console — Internal Testing

1. Open https://play.google.com/console/
2. Apps → PadelNachos → Release → **Internal testing** → Create new release
3. Upload `app-release.aab`
4. Release notes (suggested):
   ```
   - Redesigned notification settings — easier to find, instant save
   - New: tap a bookmark to set up alerts for that match
   - "Rankings updated" notification (when published)
   - Open device notification settings directly from the app
   ```
5. Save → Review release → Roll out to Internal testing

**Don't promote to Production yet.** Smoke-test first.

---

## 3. Smoke-test the Internal Testing build

Install the Internal Testing track build on your phone (you'll get an email from Play Store when it's ready, usually within 10-15 minutes).

### Critical paths to verify

1. **App boots without crashing.** Open it cold. The native-settings plugin loads as part of Capacitor's plugin discovery — if `cap sync` produced a bad config, the app crashes here.

2. **Settings → Notifications page renders correctly.** Navigate via Profile → Settings → Notifications. Confirm:
   - All 5 category toggles render with the new icon-slider style (chunky-tilted, check/X in thumb)
   - Toggling a category shows the saving → check feedback inline
   - Mute button opens the bottom sheet with 4 duration options
   - "Notification sounds" row shows a chevron

3. **Deep-links to system settings work.**
   - Tap the "Open" button in the blocked-permission banner (turn off notifications for the app in Android first to make the banner appear)
   - Tap the "Notification sounds" row
   - Both should jump directly to **Settings → Apps → PadelNachos → Notifications** on the device

4. **Bookmark nudge fires correctly.**
   - With OS notifications OFF: bookmark any match → red shield-icon sheet appears → "Open settings" deep-links to OS
   - With OS notifications ON but `match_live_bookmark.push` toggled OFF in Settings: bookmark a match → green bell-icon sheet appears → "Turn on" flips the toggle back on
   - Dismiss either nudge with "Not now" → bookmark another match within 7 days → no nudge (suppressed)

5. **In-app feed still works.** Bell icon → `/notifications` page → gear icon appears in sub-header → tapping it goes to Settings.

### If anything's broken

- **Deep-link buttons don't open settings:** the native plugin may not be in the AAB. Verify with `unzip -l app-release.aab | grep capacitor-native-settings` — should list `.class` files. If not, the cap-sync output was bad. Rebuild.
- **App crashes on boot:** check Logcat for `PluginLoadException` referencing capacitor-native-settings. Most likely a Gradle resolution issue — `cap sync` again, clean rebuild.
- **Settings page renders without categories:** i18n keys not loading. Check the production Vercel deploy is live (the web UI loads from padelnachos.com inside the WebView).

---

## 4. Promote to Production

After Internal Testing smoke passes:

1. Play Console → Production → Create new release
2. **Add from library** → select the same `app-release.aab` (versionCode 5)
3. Reuse the release notes
4. **Staged rollout** recommended: start at 20%, monitor crashes for 24h, ramp to 100% if quiet
5. Save → Review → Start rollout

---

## 5. Post-rollout monitoring

Watch for the first 24 hours:

- **Play Console → Vitals → Crashes & ANRs** — sudden spike post-rollout indicates a problem
- **Sentry** — `PluginLoadException`, `NativeSettings.open failed` patterns
- **User reports** in the app's "Open device settings" flow — anything unexpected

---

## 6. If something goes wrong (rollback)

You can halt the staged rollout from Play Console at any time. To actually roll back, you'd need to push a hotfix AAB with the broken plugin removed — there's no "previous version" rollback in Play Store (versionCode 4 is already "below" versionCode 5).

Pre-merge: if cap-sync introduces a regression discovered before release, just `git revert` the Task 21 + 22 commits on a hotfix branch. The web-only pieces (Settings page rewrite etc.) keep working with the placeholder shims that the spec was designed around.

---

## Reference

- **PR:** https://github.com/gudenes/padel-live-scores/pull/462
- **Spec:** [`docs/superpowers/specs/2026-05-27-notifications-redesign-design.md`](../specs/2026-05-27-notifications-redesign-design.md)
- **Plan:** [`docs/superpowers/plans/2026-05-27-notifications-redesign.md`](../plans/2026-05-27-notifications-redesign.md)
- **Plugin:** https://www.npmjs.com/package/capacitor-native-settings (8.1.0, MIT, Capacitor 8)
