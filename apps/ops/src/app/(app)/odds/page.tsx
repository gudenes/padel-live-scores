// apps/ops/src/app/(app)/odds/page.tsx
import { redirect } from 'next/navigation'
export default function OddsLandingRedirect() {
  redirect('/today')
}
