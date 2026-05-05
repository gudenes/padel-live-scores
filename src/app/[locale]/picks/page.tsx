import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { redirect } from '@/i18n/navigation'
import { ClientPicks } from './ClientPicks'

export default async function PicksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'prediction.myPicks' })
  const session = await auth()
  // Logged-out users get sent home — they can sign in via the avatar menu.
  // The previous redirect target (/auth/sign-in) doesn't exist; the codebase uses LoginSheet.
  if (!session?.user) redirect({ href: '/home', locale })

  return (
    <main style={{ background: '#0a0a0a', minHeight: '100vh', padding: '16px 14px', color: '#fff' }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>{t('title')}</h1>
      <ClientPicks displayName={session?.user?.name ?? 'You'} />
    </main>
  )
}
