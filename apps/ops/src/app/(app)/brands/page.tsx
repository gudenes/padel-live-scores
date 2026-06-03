import BrandsTab from './_components/BrandsTab'
import { PageHeader } from '@/components/ui'

export const metadata = { title: 'Brands & Equipment · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function BrandsPage() {
  return (
    <div className="ui-page">
      <PageHeader title="Brands & Equipment" subtitle="Manage padel brands and the racket catalog." />
      <BrandsTab />
    </div>
  )
}
