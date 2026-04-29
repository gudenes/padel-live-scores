'use client'

// /tournaments — top-level Eventos route, lives behind the bottom-tab
// "Tournaments" entry. Renders the existing TournamentsView component
// that previously lived as a sub-view of /home (toggled via
// `?view=tournaments`). Promoting it to its own route lets the bottom
// nav highlight Tournaments by pathname rather than searchParams, and
// gives shareable permalinks like padelnachos.com/tournaments.
//
// The legacy URL `/home?view=tournaments` redirects here via proxy.ts.

import { useRouter } from '@/i18n/navigation'
import { BG_BASE, PAGE_STYLES } from '@/components/home/shared'
import TournamentsView from '@/components/home/TournamentsView'

export default function TournamentsPage() {
  const router = useRouter()
  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      <style dangerouslySetInnerHTML={{ __html: PAGE_STYLES }} />
      {/* Back-arrow inside TournamentsView still hops to home. Useful
          when the user lands here via a deep link rather than the tab. */}
      <TournamentsView onBack={() => router.push('/home')} />
    </div>
  )
}
