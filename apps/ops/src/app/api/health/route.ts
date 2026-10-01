import { releaseInfo } from '@/lib/release-info'

export const dynamic = 'force-dynamic'
// The admin ships no Sentry, so SENTRY_RELEASE is not its version. Report the
// deploy-script stamp, the same value /api/version returns.
export function GET() { return Response.json({ ok: true, release: releaseInfo().sha }) }
