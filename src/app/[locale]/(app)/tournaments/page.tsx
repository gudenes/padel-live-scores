'use client'

// /tournaments — top-level Eventos route, lives behind the bottom-tab
// "Tournaments" entry. Renders the existing TournamentsView component
// that previously lived as a sub-view of /home (toggled via
// `?view=tournaments`). Promoting it to its own route lets the bottom
// nav highlight Tournaments by pathname rather than searchParams, and
// gives shareable permalinks like padelnachos.com/tournaments.
//
// The legacy URL `/home?view=tournaments` redirects here via proxy.ts.
// Uses the shared GlobalHeader (logo + search + share + profile) so
// the chrome matches the home page; TournamentsView's internal back-
// arrow header is hidden via showInternalHeader={false}.

import { BG_BASE, PAGE_STYLES } from '@/components/home/shared'
import GlobalHeader from '@/components/nav/GlobalHeader'
import TournamentsView from '@/components/home/TournamentsView'

export default function TournamentsPage() {
  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      <style dangerouslySetInnerHTML={{ __html: PAGE_STYLES }} />
      <GlobalHeader />
      {/* `onBack` is now a no-op — the GlobalHeader replaces the
          back-arrow chrome, so the deep-link "go home" affordance comes
          from the bottom-tab Home button instead. */}
      <TournamentsView onBack={() => {}} showInternalHeader={false} />
    </div>
  )
}
