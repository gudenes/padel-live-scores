import { permanentRedirect } from '@/i18n/navigation'

// Root page for each locale — permanently redirects to that locale's /home.
// e.g. / → /home, /es → /es/home
// Uses permanentRedirect (308) not redirect (307): the locale root → /home
// mapping is permanent, so a 308 lets Google consolidate signal onto /home
// instead of keeping the redirecting root URL indexed.
// createNavigation's permanentRedirect needs the object form with an explicit
// locale; a bare permanentRedirect('/home') resolves to /undefinedundefined.
export default async function LocaleRoot({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  permanentRedirect({ href: '/home', locale: locale as 'en' | 'es' | 'pt' | 'it' | 'fr' })
}
