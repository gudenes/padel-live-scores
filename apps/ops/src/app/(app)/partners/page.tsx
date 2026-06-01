import { PartnersClient } from './PartnersClient'
import { PageHeader } from '@/components/ui'

export const metadata = { title: 'Partners · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function PartnersPage() {
  return (
    <div className="ui-page">
      <PageHeader
        title="Partners"
        subtitle={'Country-keyed ecommerce partners. Click "manage" on a row to set per-racket URL overrides.'}
      />
      <PartnersClient />
    </div>
  )
}
