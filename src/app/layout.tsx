import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { getLocale } from "next-intl/server";
import { GatedAnalytics } from "@/components/GatedAnalytics";
import { GatedGoogleAds } from "@/components/GatedGoogleAds";
import { AuthProvider } from "@/components/AuthProvider";
import { PostHogIdentify } from "@/components/PostHogIdentify";
import SplashOverlay from "@/components/SplashOverlay";
import IosViewportFix from "@/components/IosViewportFix";
import { buildAlternates } from "@/lib/seo-helpers";
import "./globals.css";

// Viewport is a separate export in Next.js 16 (was a `viewport` field on
// `metadata` in older versions). `viewportFit: 'cover'` is what makes
// iOS WebViews populate the `env(safe-area-inset-*)` CSS variables —
// without this, sticky headers render under the Dynamic Island / notch
// inside the Capacitor iOS shell.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0A0A0A',
}

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
    // Match the app canvas so the mobile browser chrome blends into the UI
    // instead of pulling the eye to a lime bar above the header.
    'theme-color': '#0A0A0A',
    'msapplication-TileColor': '#0A0A0A',
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
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: 'https://padelnachos.com/search?q={search_term_string}',
        },
        'query-input': 'required name=search_term_string',
      },
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Pull the active locale from next-intl's request context so the root
  // <html lang> matches the page's language. Hardcoding "en" caused
  // Ahrefs' "Hreflang and HTML lang mismatch" error on every non-English
  // page (the locale layouts couldn't override <html> from a child).
  const locale = await getLocale()
  return (
    <html lang={locale} suppressHydrationWarning>
    <head />
    <body>
      {/* Splash overlay paints first so the WebView's initial frame
          shows our branded logo + lime arc spinner. CSS-only hide
          (no DOM mutation) — see SplashOverlay component for the
          history of the DOM-corruption bug that the v1 hit. */}
      <SplashOverlay />
      {/* Corrects the iOS cold-launch viewport-zoom race (Capacitor
          remote-URL mode). No-op on web/Safari — gated to native iOS. */}
      <IosViewportFix />
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
            <GatedGoogleAds />
          </div>
        </div>
      </div>
    </body></html>
  );
}
