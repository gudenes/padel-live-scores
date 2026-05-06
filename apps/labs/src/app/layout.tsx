import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Padel Labs — Data engine for padel content creators',
  description: 'Chat with live padel data. Generate branded stat cards. Built for analysts, YouTubers, and coaches.',
  metadataBase: new URL('https://padellabs.tech'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
