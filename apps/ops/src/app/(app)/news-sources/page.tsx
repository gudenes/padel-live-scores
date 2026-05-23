import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { NewsSourcesTabs } from './NewsSourcesTabs'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ tab?: string }>
}

export default async function NewsSourcesPage({ searchParams }: Props) {
  const session = await auth()
  if (!session?.user?.isOperator) redirect('/login')

  const params = await searchParams
  const tab = (params.tab === 'suggestions' || params.tab === 'health' ? params.tab : 'sources') as 'sources' | 'suggestions' | 'health'

  return <NewsSourcesTabs activeTab={tab} />
}
