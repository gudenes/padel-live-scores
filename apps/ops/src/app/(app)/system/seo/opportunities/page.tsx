// apps/ops/src/app/(app)/system/seo/opportunities/page.tsx
import Link from 'next/link'
import {
  getLocaleGaps,
  getInGscNotInSitemap,
  getInSitemapZeroImpressions,
  getRankCandidates,
} from '@/lib/seo/seo-queries'
import { LocaleGapsPanel } from '../_components/LocaleGapsPanel'
import { ReconciliationPanel } from '../_components/ReconciliationPanel'
import { RankCandidatesPanel } from '../_components/RankCandidatesPanel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'SEO Opportunities · PadelNachos Admin' }

export default async function Page() {
  const [gaps, inGscNotInSitemap, inSitemapZero, candidates] = await Promise.all([
    getLocaleGaps(25),
    getInGscNotInSitemap(25),
    getInSitemapZeroImpressions(),
    getRankCandidates(20),
  ])

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1080 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>SEO Opportunities</h1>
        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link href="/system/seo" style={{ color: '#6b7280', textDecoration: 'none' }}>← Overview</Link>
          <span style={{ borderBottom: '2px solid var(--brand-primary)', paddingBottom: '0.25rem', fontWeight: 500 }}>Opportunities</span>
        </nav>
      </header>

      <LocaleGapsPanel rows={gaps} />
      <ReconciliationPanel inGscNotInSitemap={inGscNotInSitemap} inSitemapZero={inSitemapZero} />
      <RankCandidatesPanel rows={candidates} />
    </div>
  )
}
