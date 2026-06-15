// src/components/MoneyExplainSheet.tsx
'use client'

// "How prize money is counted" sheet for the /rankings Money tab. Built on the
// shared ExplainSheet; copy comes from the `rankings` i18n namespace.

import { useTranslations } from 'next-intl'
import { ExplainSheet, TEXT, GOLD } from '@/components/ExplainSheet'

export function MoneyExplainSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('rankings')

  const callout = (
    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: TEXT }}>
      <b style={{ color: GOLD }}>{t('moneyExplainCalloutLead')}</b> {t('moneyExplainCalloutBody')}
    </div>
  )

  return (
    <ExplainSheet
      open={open}
      onClose={onClose}
      titleId="money-explain-title"
      title={t('moneyExplainTitle')}
      intro={t('moneyExplainIntro')}
      steps={[
        <><b>{t('moneyExplainStep1Lead')}</b> {t('moneyExplainStep1Body')}</>,
        <><b>{t('moneyExplainStep2Lead')}</b> {t('moneyExplainStep2Body')}</>,
      ]}
      highlight={callout}
      closeLabel={t('moneyExplainClose')}
    />
  )
}
