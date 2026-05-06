#!/usr/bin/env bash
# Prepare a slim webDir for Capacitor mobile builds (Android + iOS).
#
# In remote-URL mode (capacitor.config.ts -> server.url), the WebView
# loads everything from padelnachos.com. The local webDir is only used
# as a *fallback* if the remote is unreachable on first load — and even
# then, only assets explicitly referenced from the fallback HTML are
# touched.
#
# Capacitor's `npx cap sync` blindly copies the entire webDir into the
# native bundle, so by default it would drag every PNG, mockup, and
# marketing asset from public/ into the AAB. That bloats Padel Nachos
# from a ~17MB native shell to a 55MB+ download where ~37MB is unused
# branding files.
#
# This script generates `mobile-webdir/` (gitignored) — a minimal
# fallback containing just a placeholder loading page. capacitor.config.ts
# points `webDir` at this folder so `cap sync` only ships the bare minimum.
#
# Usage:
#   scripts/prepare-mobile-webdir.sh
#   npx cap sync android       # or `cap sync ios`
#
# Idempotent — safe to re-run.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEBDIR="$ROOT_DIR/mobile-webdir"

rm -rf "$WEBDIR"
mkdir -p "$WEBDIR"

# Minimal fallback: solid black page with the brand color, shown if the
# WebView can't reach padelnachos.com on first load. Capacitor's splash
# screen overlays this until JS takes over, so users almost never see it.
# The padel emoji is a graceful fallback for the brand mark — no PNG
# bytes shipped in the AAB.
cat > "$WEBDIR/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Padel Nachos</title>
<style>
  html,body{margin:0;height:100%;background:#0A0A0A;color:#fff;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
  body{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px;text-align:center;padding:40px}
  h1{font-size:24px;font-weight:800;letter-spacing:.5px;margin:0;color:#7ED321}
  p{font-size:14px;color:#9ca3af;max-width:280px;line-height:1.5;margin:0}
  .spinner{width:32px;height:32px;border:3px solid rgba(126,211,33,.2);border-top-color:#7ED321;border-radius:50%;animation:s 1s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
</style>
</head>
<body>
  <div class="spinner" aria-label="Loading"></div>
  <h1>Padel Nachos</h1>
  <p>Connecting to live scores… If this screen persists, check your internet connection.</p>
</body>
</html>
HTML

# Capacitor refuses to sync if webDir is missing common files. Add an
# empty favicon so first-paint network requests don't 404.
touch "$WEBDIR/favicon.ico"

bytes=$(du -sh "$WEBDIR" | cut -f1)
echo "✓ mobile-webdir prepared ($bytes)"
