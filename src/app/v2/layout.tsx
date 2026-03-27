// src/app/v2/layout.tsx
// Minimal layout — reuses root globals.css, no changes to existing app
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'PadelNacho v2',
  description: 'Live padel scores — new layout preview',
}

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
