export function isProdRuntime(): boolean {
  return (
    process.env.VERCEL_ENV === 'production'
    || process.env.RAILWAY_ENVIRONMENT_NAME === 'production'
    || (process.env.NODE_ENV === 'production' && !!process.env.RAILWAY_ENVIRONMENT)
  )
}

export function isHostedRuntime(): boolean {
  return !!(process.env.VERCEL_ENV || process.env.RAILWAY_ENVIRONMENT)
}

export function runtimeEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT
    ?? process.env.VERCEL_ENV
    ?? process.env.RAILWAY_ENVIRONMENT_NAME
    ?? process.env.NODE_ENV
    ?? 'development'
  )
}

export function runtimeRelease(): string | undefined {
  return (
    process.env.SENTRY_RELEASE
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.RAILWAY_GIT_COMMIT_SHA
    ?? undefined
  )
}
