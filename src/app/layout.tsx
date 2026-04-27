import type { Metadata } from "next";
import Script from "next/script";
import { GatedAnalytics } from "@/components/GatedAnalytics";
import { AuthProvider } from "@/components/AuthProvider";
import { PostHogIdentify } from "@/components/PostHogIdentify";
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
    // Multi-resolution PNG set from the 2026-04-27 favicon refresh
    // (designer brief: Padel Nachos — Favicon export · Print). Browsers
    // pick the closest match for retina + tab + bookmark contexts.
    icon: [
      { url: '/favicon-64.png', sizes: '64x64', type: 'image/png' },
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
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
    // Designer-specified lime to match the 2026-04-27 favicon refresh.
    // Drives the mobile browser address bar tint + Windows tile color.
    'theme-color': '#B6E61A',
    'msapplication-TileColor': '#B6E61A',
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
      {/* Three-tier wrapper — collapses to today's two-div layout on mobile,
          becomes a phone-frame "device shell" on desktop. The .app-canvas
          gets ambient brand-tinted background, .app-frame becomes the black
          bezel, .app-screen becomes the rounded inner screen with internal
          scroll. All controlled by media queries in globals.css; no JS gate. */}
      <div className="app-canvas" style={{ background: 'var(--bg-base)', minHeight: '100dvh' }}>
        <div className="app-frame">
          <div className="app-screen" style={{ maxWidth: 500, margin: '0 auto', minHeight: '100dvh', background: 'var(--bg-base)', borderLeft: '0.5px solid var(--border-base)', borderRight: '0.5px solid var(--border-base)' }}>
            <AuthProvider>
              {children}
              <PostHogIdentify />
            </AuthProvider>
            <GatedAnalytics />
          </div>
        </div>
      </div>
    </body></html>
  );
}
