// src/app/[locale]/(app)/pro/page.tsx
import { getTranslations } from 'next-intl/server'
import ProWaitlistButton from './ProWaitlistButton'

const FEATURES = [
  { key: 'drama' },
  { key: 'road' },
  { key: 'predictions' },
  { key: 'briefing' },
] as const

export default async function ProPage() {
  const t = await getTranslations('pro')
  return (
    <main style={{ background: '#0A0A0A', minHeight: '100vh', paddingBottom: 80 }}>
      <div style={{ padding: '24px 16px 8px', textAlign: 'center' }}>
        <span style={{ color: '#EAB308', display: 'inline-flex' }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" />
          </svg>
        </span>
        <h1 style={{ fontSize: 23, fontWeight: 800, color: '#fff', margin: '10px 0 6px' }}>{t('hero.title')}</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, margin: 0, padding: '0 6px' }}>{t('hero.sub')}</p>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {FEATURES.map(f => (
          <div key={f.key} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 14px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
          }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{t(`features.${f.key}.title`)}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 3, lineHeight: 1.4 }}>{t(`features.${f.key}.body`)}</div>
            </div>
          </div>
        ))}
        <ProWaitlistButton />
      </div>
    </main>
  )
}
