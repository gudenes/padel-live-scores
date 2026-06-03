// apps/ops/src/app/(app)/announcements/page.tsx
import { PageHeader } from '@/components/ui'
import { AnnouncementsManager } from './_components/AnnouncementsManager'

export const metadata = { title: 'Announcements · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function AnnouncementsPage() {
  return (
    <div className="ui-page">
      <PageHeader
        title="Announcements"
        subtitle="One site-wide alert banner shows at a time across the user app. Editing the message re-shows it to users who dismissed the previous version."
      />
      <AnnouncementsManager />
    </div>
  )
}
