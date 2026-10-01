import { describe, it, expect } from "vitest"
import { releaseInfo } from "../release-info"

describe("releaseInfo", () => {
  it("prefers the deploy-script stamp", () => {
    const r = releaseInfo({ RELEASE_SHA: "abc", RAILWAY_GIT_COMMIT_SHA: "def", SENTRY_RELEASE: "ghi", RELEASE_BRANCH: "main", RELEASE_AT: "2026-10-01T00:00:00Z", RAILWAY_SERVICE_NAME: "padelnachos" })
    expect(r).toMatchObject({ sha: "abc", source: "deploy-script", branch: "main", releasedAt: "2026-10-01T00:00:00Z", service: "padelnachos" })
  })
  it("falls back to a GitHub-triggered deploy, then the legacy Sentry stamp", () => {
    expect(releaseInfo({ RAILWAY_GIT_COMMIT_SHA: "def", RAILWAY_GIT_BRANCH: "main" })).toMatchObject({ sha: "def", source: "github", branch: "main" })
    expect(releaseInfo({ SENTRY_RELEASE: "ghi" })).toMatchObject({ sha: "ghi", source: "sentry-stamp" })
  })
  it("reports unknown, never undefined, when nothing is stamped", () => {
    expect(releaseInfo({})).toEqual({ service: null, sha: null, branch: null, releasedAt: null, deploymentId: null, source: "unknown" })
  })
  it("exposes only the expected keys (no env leakage)", () => {
    const keys = Object.keys(releaseInfo({ RELEASE_SHA: "a", CRON_SECRET: "x", DATABASE_URL: "y" })).sort()
    expect(keys).toEqual(["branch", "deploymentId", "releasedAt", "service", "sha", "source"])
  })
})
