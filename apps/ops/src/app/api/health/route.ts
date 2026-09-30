export const dynamic = 'force-dynamic'
export function GET() { return Response.json({ok:true,release:process.env.SENTRY_RELEASE ?? null}) }
