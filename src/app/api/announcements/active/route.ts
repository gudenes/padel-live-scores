// src/app/api/announcements/active/route.ts
// Public, cached read of the active site announcement (or null). Mirrors the
// service-client + cache pattern of src/app/api/ads/active/route.ts. Time-window
// + newest-wins selection is delegated to selectActiveAnnouncement so it stays
// unit-tested. Degrades to { announcement: null } on any error (never breaks the app).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { selectActiveAnnouncement, type Announcement } from '@/lib/announcement'

export async function GET() {
  const supabase = createServerClient()
  try {
    // NOTE: createServerClient uses the service key and BYPASSES RLS. The
    // `.eq('active', true)` filter below — not the anon-read RLS policy — is
    // what keeps inactive/scheduled/expired drafts out of this public response.
    // Don't remove it. (The RLS policy only guards direct anon-key reads.)
    const { data } = await supabase
      .from('site_announcements')
      .select('id, title, message, type, active, starts_at, expires_at, updated_at')
      .eq('active', true)

    const announcement = selectActiveAnnouncement(
      (data ?? []) as Announcement[],
      Date.now(),
    )

    return NextResponse.json(
      { announcement },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } },
    )
  } catch {
    return NextResponse.json({ announcement: null })
  }
}
