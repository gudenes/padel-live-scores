// apps/ops/src/app/(app)/system/seo/opportunities/page.tsx
import Link from 'next/link'
import {
  getLocaleGaps,
  getInGscNotInSitemap,
  getInSitemapZeroImpressions,
  getRankCandidates,
} from '@/lib/seo/seo-queries'
import { PageHeader } from '@/components/ui'
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
    <div className="ui-page" style={{ maxWidth: 1080 }}>
      <PageHeader
        title="SEO Opportunities"
        actions={
          <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Link href="/system/seo" style={{ color: 'var(--text-3)', textDecoration: 'none' }}>← Overview</Link>
            <span style={{ borderBottom: '2px solid var(--lime)', paddingBottom: '0.25rem', fontWeight: 500, color: 'var(--text-1)' }}>Opportunities</span>
          </nav>
        }
      />

      <LocaleGapsPanel rows={gaps} />
      <ReconciliationPanel inGscNotInSitemap={inGscNotInSitemap} inSitemapZero={inSitemapZero} />
      <RankCandidatesPanel rows={candidates} />
    </div>
  )
}
