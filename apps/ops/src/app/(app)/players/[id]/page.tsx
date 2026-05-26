// apps/ops/src/app/(app)/players/[id]/page.tsx
// Full-profile route for a single player. Thin Server Component that
// delegates data fetching to the client orchestrator — keeps auth-cookie
// forwarding (which is fiddly in Next 16 server-side fetch) out of scope.

import PlayerProfile from './_components/PlayerProfile'

interface Props {
  params: Promise<{ id: string }>
}

export const metadata = { title: 'Player · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function Page({ params }: Props) {
  const { id } = await params
  return <PlayerProfile playerId={id} />
}
