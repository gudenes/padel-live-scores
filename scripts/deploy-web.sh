#!/usr/bin/env bash
# Deploy the Next.js app to Railway (service: padelnachos, project: hearty-charm).
#
# WHY a script rather than a bare `railway up`: the service deploys from a
# LOCAL directory, not from GitHub, so Railway never populates
# RAILWAY_GIT_COMMIT_SHA. Sentry's release therefore has to be stamped from
# the local git sha at deploy time, or every build reports errors with a
# stale (or empty) release and the uploaded source maps never match — which
# is exactly the state production was in before 2026-08-23.
#
# Usage:  ./scripts/deploy-web.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "refusing to deploy: working tree is dirty." >&2
  echo "the sha stamped into Sentry would not describe what actually ships." >&2
  git status --short >&2
  exit 1
fi

SHA="$(git rev-parse HEAD)"
echo "==> deploying $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

# Both are needed: NEXT_PUBLIC_* is inlined into the client bundle at BUILD
# time, the bare one is read by the server runtime. --skip-deploys so setting
# them doesn't race the `railway up` below.
railway variables --service padelnachos \
  --set "NEXT_PUBLIC_SENTRY_RELEASE=$SHA" \
  --set "SENTRY_RELEASE=$SHA" \
  --skip-deploys

# .env.local is gitignored (so `railway up` already skips it), but a stray
# copy in a worktree has no business being uploaded either way.
if [[ -f .env.local ]]; then
  echo "refusing to deploy: .env.local present. Remove it first." >&2
  exit 1
fi

railway up --service padelnachos --ci

echo "==> verifying"
for _ in $(seq 1 40); do
  if [[ "$(curl -fsS -o /dev/null -w '%{http_code}' https://padelnachos.com/api/health)" == "200" ]]; then
    echo "health OK — deployed $SHA"
    exit 0
  fi
  sleep 3
done
echo "health check never returned 200 — investigate with: railway logs -s padelnachos" >&2
exit 1
