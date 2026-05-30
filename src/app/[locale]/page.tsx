import { redirect } from '@/i18n/navigation'

// Root page for each locale — redirects to that locale's /home.
// e.g. / → /home, /es → /es/home
// createNavigation's redirect needs the object form with an explicit locale;
// a bare redirect('/home') resolves to /undefinedundefined.
export default async function LocaleRoot({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect({ href: '/home', locale: locale as 'en' | 'es' | 'pt' | 'it' | 'fr' })
}
