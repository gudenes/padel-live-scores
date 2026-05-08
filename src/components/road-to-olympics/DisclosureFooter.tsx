// src/components/road-to-olympics/DisclosureFooter.tsx
//
// Honest-disclosure footer. Renders on every road-to-olympics surface.

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export default function DisclosureFooter() {
  const t = useTranslations('roadToOlympics.disclosure')
  return (
    <footer style={{
      marginTop: 24,
      paddingTop: 14,
      borderTop: '1px solid rgba(255,255,255,0.08)',
      fontSize: 11,
      color: '#888',
      textAlign: 'center',
      lineHeight: 1.5,
    }}>
      <div>{t('line1')}</div>
      <div>
        {t('line2')}{' '}
        <Link href="/road-to-olympics/why" style={{ color: '#7ed321' }}>
          {t('readWhy')}
        </Link>
      </div>
    </footer>
  )
}
