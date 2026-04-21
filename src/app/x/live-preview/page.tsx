// src/app/x/live-preview/page.tsx
// Hidden preview page — noindex, nofollow, no public linking.

import type { Metadata } from 'next'
import ShadowLivePreview from './ShadowLivePreview'

export const metadata: Metadata = {
  title: 'Shadow Live Preview',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function Page() {
  return <ShadowLivePreview />
}
