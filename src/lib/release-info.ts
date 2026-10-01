// What is this service running? Stamped by scripts/deploy.sh (RELEASE_*); falls back to
// what Railway or the older Sentry stamp provide. Contains no secrets.

export interface ReleaseInfo {
  service: string | null
  sha: string | null
  branch: string | null
  releasedAt: string | null
  deploymentId: string | null
  /** where the sha came from: the deploy script, a GitHub-triggered deploy, the legacy Sentry stamp, or nothing */
  source: "deploy-script" | "github" | "sentry-stamp" | "unknown"
}

export function releaseInfo(env: Record<string, string | undefined> = process.env): ReleaseInfo {
  const sha = env.RELEASE_SHA || env.RAILWAY_GIT_COMMIT_SHA || env.SENTRY_RELEASE || null
  const source: ReleaseInfo["source"] = env.RELEASE_SHA
    ? "deploy-script"
    : env.RAILWAY_GIT_COMMIT_SHA
      ? "github"
      : env.SENTRY_RELEASE
        ? "sentry-stamp"
        : "unknown"
  return {
    service: env.RAILWAY_SERVICE_NAME || null,
    sha,
    branch: env.RELEASE_BRANCH || env.RAILWAY_GIT_BRANCH || null,
    releasedAt: env.RELEASE_AT || null,
    deploymentId: env.RAILWAY_DEPLOYMENT_ID || null,
    source,
  }
}
