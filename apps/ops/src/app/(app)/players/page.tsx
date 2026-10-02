import { Suspense } from 'react'
import PlayersViews from './_components/PlayersViews'

export const metadata = { title: 'Players · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function PlayersPage() {
  return (
    <Suspense>
      <PlayersViews />
    </Suspense>
  )
}
