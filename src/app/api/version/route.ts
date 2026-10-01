import { NextResponse } from "next/server"
import { releaseInfo } from "@/lib/release-info"

export const dynamic = "force-dynamic"

// GET /api/version — which commit is this service running? Compare with
// `git rev-parse origin/main`. Public on purpose; no secrets in the payload.
export function GET() {
  return NextResponse.json(releaseInfo(), { headers: { "cache-control": "no-store" } })
}
