// apps/ops/src/app/(app)/entry-lists/page.tsx
// Standalone Entry Lists nav destination. Reuses the component already
// lifted under tournament-explorer/_components/ (Plan 3a Task 17) so
// operators can reach the entry-list workflow either through a
// tournament's detail view or directly from the sidebar.

import PadelgodEntryListTab from '../tournament-explorer/_components/PadelgodEntryListTab'

export const metadata = { title: 'Entry Lists · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function EntryListsPage() {
  return <PadelgodEntryListTab />
}
