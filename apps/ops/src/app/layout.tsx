// apps/ops/src/app/layout.tsx
// Root layout. Variation 2 design tokens applied via globals.css.

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PadelNachos Admin',
  description: 'Operations dashboard',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
