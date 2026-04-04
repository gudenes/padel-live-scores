import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: 'Padel Nachos — Live Padel Scores, Rankings & News',
    template: '%s | Padel Nachos',
  },
  description: 'Real-time padel scores, live match tracking, player rankings, tournament brackets, and news from Premier Padel, FIP, and more. Your go-to padel companion.',
  metadataBase: new URL('https://padelnachos.com'),
  applicationName: 'Padel Nachos',
  keywords: ['padel', 'live scores', 'padel scores', 'Premier Padel', 'FIP', 'padel rankings', 'padel tournaments', 'padel news', 'padel results', 'world padel tour'],
  authors: [{ name: 'Padel Nachos' }],
  creator: 'Padel Nachos',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://padelnachos.com',
    siteName: 'Padel Nachos',
    title: 'Padel Nachos — Live Padel Scores, Rankings & News',
    description: 'Real-time padel scores, live match tracking, player rankings, tournament brackets, and news from Premier Padel, FIP, and more.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Padel Nachos' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Padel Nachos — Live Padel Scores, Rankings & News',
    description: 'Real-time padel scores, live match tracking, player rankings, and tournament news.',
    images: ['/og-image.png'],
  },
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Padel Nachos',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'theme-color': '#020C18',
    'msapplication-TileColor': '#020C18',
  },
};

function ServiceWorkerRegistration() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js')
                .catch(function(err) { console.log('[SW] Registration failed:', err); });
            });
          }
        `,
      }}
    />
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>
      <ServiceWorkerRegistration />
      <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
        <div style={{ maxWidth: 500, margin: '0 auto', minHeight: '100vh', background: 'var(--bg-base)', borderLeft: '0.5px solid var(--border-base)', borderRight: '0.5px solid var(--border-base)' }}>
          <AuthProvider>
            {children}
          </AuthProvider>
          <Analytics />
        </div>
      </div>
    </body></html>
  );
}
