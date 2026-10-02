import { betaLocale } from '@/lib/beta-copy'
import MiniGame from './mini-game'

export const metadata = { title: 'Padel Predict · Demo', robots: { index: false, follow: false } }

export default async function DemoPage({ params, searchParams }: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const tracking = new URLSearchParams()
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'rdt_cid']) {
    const value = query[key]
    if (typeof value === 'string') tracking.set(key, value)
  }
  const suffix = tracking.size ? `?${tracking.toString()}` : ''
  return <MiniGame locale={betaLocale((await params).locale)} signupHref={`/beta${suffix}#beta-signup`} />
}
