<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Rules for every agent (Claude, Codex/OpenAI, Cursor, Gemini, Copilot, …)

This file is the shared instruction set. `CLAUDE.md` imports it; other agents read it directly. Keep rules that apply to every agent **here**, not in a tool-specific file.

## 1. Start of every session — check the latest version first

Before building, fixing or deploying anything, run:

```bash
./scripts/session-check.sh
```

It is read-only. It fetches `origin/main`, shows whether this checkout is behind or has uncommitted work, and compares what **production actually runs** (web, admin, Padel God, cron) with `origin/main`.

- **"Latest" means what prod runs, not only what `main` has.** Prod has run unmerged branches before (2026-09-30), and a merge does not deploy web/admin/cron.
- If any service shows **⚠ NOT on main** or **unknown**, stop and tell Gustavo before doing anything else.
- **Start new work from `origin/main` in its own worktree**, never on whatever branch the main folder has checked out:
  ```bash
  git fetch origin && git worktree add -b <type>/<short-name> .claude/worktrees/<short-name> origin/main
  ```
  The main folder (`/Volumes/Crucial/dev/padel-live-scores`) is shared by several concurrent agent sessions. Its branch can change under you, and its uncommitted files usually belong to someone else. Never commit, reset, stash or check out over them.

## 2. Talk before any fix

When something is broken (prod incident, bad notification, missing schedule, live status, …):

1. Investigate and show evidence of what happened.
2. Propose the change in plain language.
3. **Do not write a hotfix, edit production data, or deploy until Gustavo confirms.**

Diagnosis ≠ permission to ship.

## 3. Deploying (Railway + Cloudflare; Vercel is retired)

| Service | How it deploys |
|---|---|
| **Padel God** (padelgod workers) | **Automatically** on every merge to `main` (GitHub-triggered). Never `railway up` it by hand. |
| **padelnachos** (web) | `./scripts/deploy.sh web` |
| **padelnachos-admin** | `./scripts/deploy.sh admin` |
| **padelnachos-cron** | `./scripts/deploy.sh cron` |

- **Merge to `main` first, then deploy from a clean checkout of `origin/main`.** `deploy.sh` refuses a dirty tree, an unpushed commit, a commit not on `origin/main`, or a deploy that would **drop commits prod is running**. Run `--dry-run` first. Never use a bare `railway up` for web/admin/cron.
- **One service at a time.** Each upload is ~100 MB, and parallel uploads have filled the Mac's system disk.
- **Slow connection?** `export RAILWAY_HTTP_TIMEOUT=600` before `deploy.sh`. An HTTP `524` on upload is Railway's ~100 s edge limit, so just retry. A failed upload is safe: the script restores the version stamp, and the previous build keeps serving.
- **What is running now?** `curl https://padelnachos.com/api/version` (or `admin.padelnachos.com/api/version`) → `{ sha, branch, releasedAt, source }`. Cron logs `cron-runner-up … release=<sha>` at startup. Or just run `./scripts/session-check.sh`.
- Deploying is outward-facing: only deploy when Gustavo asked for it.
