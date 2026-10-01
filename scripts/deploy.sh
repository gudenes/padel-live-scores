#!/usr/bin/env bash
# Deploy one Railway service from this checkout — safely.
#
# Usage:  ./scripts/deploy.sh <web|admin|cron> [--dry-run] [--yes]
#                             [--allow-unmerged] [--allow-rollback]
#
# WHY: these services deploy from a LOCAL directory (`railway up`), not from
# GitHub, so Railway records no commit for them. That made it easy to upload a
# stale or unmerged tree and silently revert what prod was running. This script:
#   1. refuses a dirty tree or a commit that is not pushed,
#   2. refuses a commit that is not on origin/main (unless --allow-unmerged),
#   3. reads the SHA prod is running now and refuses to DROP commits it has
#      (unless --allow-rollback),
#   4. stamps RELEASE_SHA / RELEASE_BRANCH / RELEASE_AT on the service, so
#      GET /api/version (web, admin) and the cron startup log say what runs,
#   5. uploads from the right directory and verifies the new SHA is serving.
#
# --dry-run runs every check and prints the plan; it changes nothing.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//' >&2; }
KEY="${1:-}"; [[ $# -gt 0 ]] && shift || true
DRY=0; YES=0; ALLOW_UNMERGED=0; ALLOW_ROLLBACK=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --yes|-y) YES=1 ;;
    --allow-unmerged) ALLOW_UNMERGED=1 ;;
    --allow-rollback) ALLOW_ROLLBACK=1 ;;
    *) echo "unknown option: $a" >&2; usage; exit 2 ;;
  esac
done

case "$KEY" in
  web)   SERVICE=padelnachos;       VERIFY_URL="https://padelnachos.com/api/version" ;;
  admin) SERVICE=padelnachos-admin; VERIFY_URL="https://admin.padelnachos.com/api/version" ;;
  cron)  SERVICE=padelnachos-cron;  VERIFY_URL="" ;;
  *) usage; exit 2 ;;
esac

fail() { echo "refusing to deploy: $*" >&2; exit 1; }

# 1. clean tree, no stray env file
[[ -z "$(git status --porcelain)" ]] || { git status --short >&2; fail "working tree is dirty — the stamped SHA would not describe what ships."; }
[[ ! -f .env.local ]] || fail ".env.local present in the repo root. Remove it first."

# 2. pushed, and on main
git fetch origin --quiet
SHA="$(git rev-parse HEAD)"; SHORT="$(git rev-parse --short HEAD)"; BRANCH="$(git rev-parse --abbrev-ref HEAD)"
# A detached checkout of origin/main reports "HEAD"; record the branch it really is.
[[ "$BRANCH" != "HEAD" ]] || ! git merge-base --is-ancestor "$SHA" origin/main || BRANCH=main
[[ -n "$(git branch -r --contains "$SHA" 2>/dev/null)" ]] || fail "commit $SHORT is not pushed to origin. Push it first, so it can be found later."
BEHIND="$(git rev-list --count HEAD..origin/main)"
if ! git merge-base --is-ancestor "$SHA" origin/main; then
  if [[ $ALLOW_UNMERGED -eq 1 ]]; then
    echo "WARNING: $SHORT is NOT on origin/main (--allow-unmerged)." >&2
  else
    fail "$SHORT is not on origin/main. Merge it first, or pass --allow-unmerged on purpose."
  fi
fi
[[ "$BEHIND" -eq 0 ]] || echo "WARNING: origin/main has $BEHIND commit(s) that this checkout does not." >&2

# 3. what is prod running now? never silently drop its commits
var_of() {  # print a variable's value from the service, or nothing
  railway variables --service "$SERVICE" --json 2>/dev/null \
    | python3 -c "import sys,json
try: d=json.load(sys.stdin)
except Exception: d={}
print(d.get('$1') or '')" 2>/dev/null || true
}
CURRENT="$(var_of RELEASE_SHA)"
[[ -n "$CURRENT" || "$KEY" != "web" ]] || CURRENT="$(var_of SENTRY_RELEASE)"
if [[ -z "$CURRENT" ]]; then
  echo "NOTE: prod's current version is unknown (no RELEASE_SHA stamp). I cannot check that this deploy keeps what prod has." >&2
  UNKNOWN=1
else
  UNKNOWN=0
  if ! git cat-file -e "${CURRENT}^{commit}" 2>/dev/null; then
    [[ $ALLOW_ROLLBACK -eq 1 ]] || fail "prod runs ${CURRENT:0:9}, which this checkout does not have. Fetch it, or pass --allow-rollback."
  elif ! git merge-base --is-ancestor "$CURRENT" "$SHA"; then
    LOST="$(git rev-list --count "$SHA..$CURRENT")"
    [[ $ALLOW_ROLLBACK -eq 1 ]] || fail "this would DROP $LOST commit(s) prod is running (${CURRENT:0:9} is not an ancestor of $SHORT). Pass --allow-rollback only if that is intended."
    echo "WARNING: dropping $LOST commit(s) prod is running (--allow-rollback)." >&2
  fi
fi

# 4. where to upload from (admin moved between layouts)
UPLOAD_DIR="."
if [[ "$KEY" == "admin" ]] && ! grep -q 'padelnachos-admin' railway.toml 2>/dev/null; then UPLOAD_DIR="apps/ops"; fi

echo "==> plan"
echo "    service : $SERVICE ($KEY)"
echo "    commit  : $SHORT on $BRANCH (origin/main is $BEHIND ahead of this checkout)"
echo "    prod now: ${CURRENT:0:9}${CURRENT:+ }$([[ $UNKNOWN -eq 1 ]] && echo '(unknown)')"
echo "    upload  : $UPLOAD_DIR"
echo "    verify  : ${VERIFY_URL:-cron startup log}"
if [[ $DRY -eq 1 ]]; then echo "==> dry run: nothing changed."; exit 0; fi

if [[ $YES -ne 1 ]]; then
  [[ $UNKNOWN -eq 1 ]] && echo "Type 'unknown' to deploy over an unknown version, or anything else to abort:" || echo "Type 'deploy' to continue:"
  read -r ANSWER
  WANT="deploy"; [[ $UNKNOWN -eq 1 ]] && WANT="unknown"
  [[ "$ANSWER" == "$WANT" ]] || fail "not confirmed."
fi

# 5. stamp, upload, verify (put every stamped variable back if the upload fails)
STAMP_KEYS=(RELEASE_SHA RELEASE_BRANCH RELEASE_AT)
[[ "$KEY" != "web" ]] || STAMP_KEYS+=(NEXT_PUBLIC_SENTRY_RELEASE SENTRY_RELEASE)
PREV=()
for k in "${STAMP_KEYS[@]}"; do PREV+=(--set "$k=$(var_of "$k")"); done
STAMP=(--set "RELEASE_SHA=$SHA" --set "RELEASE_BRANCH=$BRANCH" --set "RELEASE_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)")
[[ "$KEY" != "web" ]] || STAMP+=(--set "NEXT_PUBLIC_SENTRY_RELEASE=$SHA" --set "SENTRY_RELEASE=$SHA")
railway variables --service "$SERVICE" "${STAMP[@]}" --skip-deploys >/dev/null

restore() {
  # Previous values, verbatim. An unset key comes back as "" — release-info treats
  # an empty RELEASE_SHA as absent, so /api/version never claims a SHA that isn't serving.
  echo "upload failed — restoring the previous stamp." >&2
  railway variables --service "$SERVICE" "${PREV[@]}" --skip-deploys >/dev/null \
    || echo "WARNING: could not restore the stamp; fix ${STAMP_KEYS[*]} on $SERVICE by hand." >&2
}
# Cron has no HTTP listener or healthcheck, so `railway up --ci` never returns for
# it (seen 2026-10-01: the deploy succeeded at 07:30, the CLI was still attached at
# 09:50). Upload detached, then follow the deployment itself. Builders can queue for
# 30 min, so wait up to 45 min. A build that fails leaves the old runner serving, so
# the stamp is restored; a timeout leaves it alone and says so.
deployment_field() {  # <deployment id> <field>
  railway deployment list --service "$SERVICE" --json 2>/dev/null | python3 -c "import sys,json
try: d=json.load(sys.stdin)
except Exception: d=[]
print(next((x.get('$2') or '' for x in d if x.get('id')=='$1'), ''))" 2>/dev/null || true
}
cron_deploy() {
  local before out id status
  before="$(railway deployment list --service "$SERVICE" --json 2>/dev/null | python3 -c "import sys,json
try: print(json.load(sys.stdin)[0]['id'])
except Exception: print('')" 2>/dev/null || true)"
  if ! out="$(cd "$UPLOAD_DIR" && railway up --service "$SERVICE" --detach --json)"; then
    restore; fail "railway up failed; the previous deployment is still serving."
  fi
  id="$(printf '%s' "$out" | python3 -c "import sys,json,re
t=sys.stdin.read()
try: d=json.loads(t); print(d.get('deploymentId') or d.get('id') or '')
except Exception:
  m=re.search(r'[?&]id=([0-9a-f-]{36})', t); print(m.group(1) if m else '')" 2>/dev/null || true)"
  if [[ -z "$id" ]]; then  # fall back to the newest deployment, if it is new
    id="$(railway deployment list --service "$SERVICE" --json 2>/dev/null | python3 -c "import sys,json
try: print(json.load(sys.stdin)[0]['id'])
except Exception: print('')" 2>/dev/null || true)"
    [[ "$id" != "$before" ]] || id=""
  fi
  [[ -n "$id" ]] || { echo "uploaded, but could not find the new deployment id. Check: railway deployment list --service $SERVICE" >&2; exit 1; }
  echo "==> deployment $id — waiting for it (builders can queue for a while)"
  for _ in $(seq 1 540); do
    status="$(deployment_field "$id" status)"
    case "$status" in
      SUCCESS)
        if railway logs "$id" --service "$SERVICE" --lines 2000 2>/dev/null | grep 'cron-runner-up' | grep -q "$SHA"; then
          echo "OK — $SERVICE runner started on $SHORT"; exit 0
        fi ;;
      FAILED|CRASHED|REMOVED|SKIPPED)
        restore; fail "deployment $id ended $status; the previous runner is still serving." ;;
    esac
    sleep 5
  done
  echo "deployment $id still not confirmed after 45 min (status: ${status:-unknown}). The stamp says $SHORT; check: railway deployment list --service $SERVICE" >&2
  exit 1
}

# `railway up .` fails with "prefix not found" (CLI 5.63), so never pass a path:
# run the CLI from inside the upload directory instead.
if [[ "$KEY" == "cron" ]]; then
  cron_deploy  # exits
fi
if ! (cd "$UPLOAD_DIR" && railway up --service "$SERVICE" --ci); then restore; fail "railway up failed; the previous deployment is still serving."; fi

echo "==> verifying"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 10 "$VERIFY_URL" 2>/dev/null | grep -q "\"sha\":\"$SHA\""; then echo "OK — $SERVICE is serving $SHORT"; exit 0; fi
  sleep 5
done
echo "could not confirm $SHORT is serving. Check: railway logs --service $SERVICE" >&2
exit 1
