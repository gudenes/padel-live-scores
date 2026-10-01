#!/usr/bin/env bash
# Start-of-session check for ANY agent (Claude, Codex/OpenAI, Cursor, Gemini, …)
# and for humans. READ-ONLY: it fetches and reads; it never changes a branch,
# a file, a deployment or a Railway variable.
#
# Answers two questions before any work starts:
#   1. Is this checkout up to date with origin/main (and is it safe to work in)?
#   2. Is production running origin/main — or something else?
#
# Usage: ./scripts/session-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."

PROJECT=ec638a56-c42f-4fa6-9216-dcd7668e34b7
short() { printf '%s' "${1:0:9}"; }

git fetch origin --prune --quiet 2>/dev/null || echo "WARNING: git fetch failed — results below may be stale."
MAIN="$(git rev-parse origin/main)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
AHEAD="$(git rev-list --count origin/main..HEAD)"
BEHIND="$(git rev-list --count HEAD..origin/main)"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"

echo "== This checkout"
echo "   origin/main : $(short "$MAIN")  $(git log -1 --format=%s origin/main)"
echo "   branch      : $BRANCH @ $(git rev-parse --short=9 HEAD)  (ahead $AHEAD, behind $BEHIND)"
echo "   uncommitted : $DIRTY file(s)"
[[ "$BEHIND" -eq 0 ]] || echo "   ⚠ behind origin/main — start new work from a fresh worktree off origin/main, don't build on this."
[[ "$DIRTY" -eq 0 ]] || echo "   ⚠ uncommitted changes here may belong to another session — don't commit, reset or stash them."

echo "== Production vs origin/main"
DRIFT=0
check_http() {  # <name> <url>
  local sha
  sha="$(curl -fsS --max-time 10 "$2" 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("sha") or "")' 2>/dev/null)"
  report "$1" "$sha"
}
report() {  # <name> <sha>
  if [[ -z "$2" ]]; then echo "   $1: unknown"; DRIFT=1
  elif [[ "$2" == "$MAIN" ]]; then echo "   $1: $(short "$2") ✅ = main"
  elif git merge-base --is-ancestor "$2" "$MAIN" 2>/dev/null; then echo "   $1: $(short "$2") — behind main by $(git rev-list --count "$2..$MAIN") commit(s)"
  else echo "   $1: $(short "$2") ⚠ NOT on main — prod runs code main doesn't have"; DRIFT=1
  fi
}
check_http web   https://padelnachos.com/api/version
check_http admin https://admin.padelnachos.com/api/version

if command -v railway >/dev/null 2>&1; then
  pg="$(railway deployment list --service 'Padel God' --project "$PROJECT" --environment production --json 2>/dev/null \
    | python3 -c 'import sys,json
d=[x for x in json.load(sys.stdin) if x.get("status")=="SUCCESS"]
print((d[0]["meta"].get("commitHash") or "") if d else "")' 2>/dev/null)"
  report "padelgod" "$pg"
  cron="$(railway variables --service padelnachos-cron --project "$PROJECT" --environment production --json 2>/dev/null \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("RELEASE_SHA") or "")' 2>/dev/null)"
  report "cron (stamp)" "$cron"
else
  echo "   padelgod / cron: railway CLI not installed — skipped"
fi

echo
if [[ $DRIFT -eq 1 ]]; then
  echo "⚠ Production is not cleanly on main (see above). Tell the user before building or deploying anything."
else
  echo "OK — build new work from origin/main. 'behind main' just means a deploy is pending."
fi
