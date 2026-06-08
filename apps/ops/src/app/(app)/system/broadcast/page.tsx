import BroadcastView from './_components/BroadcastView'
import { listRecentSends } from '@/lib/broadcast-queries'

export const metadata = { title: 'Broadcast · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function BroadcastPage() {
  const sends = await listRecentSends()
  return <BroadcastView initialSends={sends} />
}
