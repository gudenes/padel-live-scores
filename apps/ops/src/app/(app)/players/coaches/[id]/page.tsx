// Coach detail page. Static segment `players/coaches/[id]` wins over `players/[id]`.
import CoachProfile from './_components/CoachProfile'

export const metadata = { title: 'Coach · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CoachProfile key={id} coachId={id} />
}
