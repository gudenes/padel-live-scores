import type { Metadata } from "next";
import Script from "next/script";
import { GatedAnalytics } from "@/components/GatedAnalytics";
import { AuthProvider } from "@/components/AuthProvider";
import { buildAlternates } from "@/lib/seo-helpers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: 'Padel Nachos — Live Padel Scores & Results',
    template: '%s | Padel Nachos',
  },
  description: 'Follow every point live. Real-time scores, player rankings, tournament draws, highlights, and breaking news from Premier Padel and FIP — all in one app.',
  metadataBase: new URL('https://padelnachos.com'),
  applicationName: 'Padel Nachos',
  keywords: ['padel', 'live scores', 'padel scores', 'padel results', 'Premier Padel', 'FIP', 'padel rankings', 'padel tournaments', 'padel news', 'world padel tour', 'padel live', 'padel app'],
  authors: [{ name: 'Padel Nachos' }],
  creator: 'Padel Nachos',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://padelnachos.com',
    siteName: 'Padel Nachos',
    title: 'Padel Nachos — Live Padel Scores & Results',
    description: 'Follow every point live. Real-time scores, player rankings, tournament draws, highlights, and breaking news from Premier Padel and FIP.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Padel Nachos — Live Padel Scores & Results' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Padel Nachos — Live Padel Scores & Results',
    description: 'Follow every point live. Real-time scores, rankings, tournament draws, and news from Premier Padel and FIP.',
    images: ['/og-image.png'],
  },
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
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
  verification: {
    google: '8IikbOTQM3xnjHsanK2iCR8B6tVQeSzCT5HMXyiyHlM',
  },
  alternates: {
    canonical: 'https://padelnachos.com',
    languages: {
      'en': 'https://padelnachos.com',
      'es': 'https://padelnachos.com/es',
      'pt': 'https://padelnachos.com/pt',
      'fr': 'https://padelnachos.com/fr',
      'it': 'https://padelnachos.com/it',
      'x-default': 'https://padelnachos.com',
    },
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'theme-color': '#020C18',
    'msapplication-TileColor': '#020C18',
  },
};

// JSON-LD structured data for Google rich results
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://padelnachos.com/#website',
      url: 'https://padelnachos.com',
      name: 'Padel Nachos',
      description: 'Follow every point live. Real-time scores, player rankings, tournament draws, highlights, and breaking news from Premier Padel and FIP.',
      inLanguage: 'en',
    },
    {
      '@type': 'WebApplication',
      '@id': 'https://padelnachos.com/#app',
      name: 'Padel Nachos',
      url: 'https://padelnachos.com',
      applicationCategory: 'SportsApplication',
      operatingSystem: 'Any',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
    },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
    <head />
    <body>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <Script
        id="sw-registration"
        strategy="afterInteractive"
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
      <div style={{ background: 'var(--bg-base)', minHeight: '100dvh' }}>
        <div style={{ maxWidth: 500, margin: '0 auto', minHeight: '100dvh', background: 'var(--bg-base)', borderLeft: '0.5px solid var(--border-base)', borderRight: '0.5px solid var(--border-base)' }}>
          <AuthProvider>
            {children}
          </AuthProvider>
          <GatedAnalytics />
        </div>
      </div>
    </body></html>
  );
}
