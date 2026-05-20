// apps/ops/src/app/page.tsx
// Until the Today page exists (Plan 2), the root redirects to /login.
// Plan 2 will redirect to /today instead.

import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/login')
}
