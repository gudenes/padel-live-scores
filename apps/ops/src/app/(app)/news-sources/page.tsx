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
  const validTabs = ['sources', 'suggestions', 'articles', 'health'] as const
  type Tab = typeof validTabs[number]
  const tab: Tab = (validTabs.includes(params.tab as Tab) ? params.tab : 'sources') as Tab

  return <NewsSourcesTabs activeTab={tab} />
}
