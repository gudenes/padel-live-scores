// apps/ops/src/app/(app)/ads/page.tsx
import AdsTab from './_components/AdsTab'

export const metadata = { title: 'Ad Banners · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function AdsPage() {
  return <AdsTab />
}
