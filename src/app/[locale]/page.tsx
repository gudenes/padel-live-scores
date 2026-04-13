import { redirect } from 'next/navigation'

// Root page for each locale — redirects to /home
// e.g. / → /home, /es → /es/home
export default function LocaleRoot() {
  redirect('/home')
}
