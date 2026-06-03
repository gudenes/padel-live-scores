// apps/ops/src/app/layout.tsx
// Root layout. Variation 2 design tokens applied via globals.css.

import type { Metadata } from 'next'
import './globals.css'
import './ui.css'

export const metadata: Metadata = {
  title: 'PadelNachos Admin',
  description: 'Operations dashboard',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` on the html + body elements only — silences
    // React's hydration mismatch error when a system-level browser extension
    // (Bitdefender's `bis_skin_checked` / `bis_register`, Grammarly,
    // ColorZilla, etc.) mutates attributes on those elements before React
    // hydrates. The flag does NOT cascade to children, so real hydration
    // bugs further down the tree still surface as errors.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
