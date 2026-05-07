'use client'
// Loads Google Ads gtag.js (AW-18147012848) only after the user has
// granted analytics consent via the cookie banner. Mirrors GatedAnalytics:
// useConsent's hasDecided is false on the server and on the first client
// render, so server HTML never includes the loader.

import Script from 'next/script'
import { useConsent } from '@/hooks/useConsent'

const GOOGLE_ADS_ID = 'AW-18147012848'

export function GatedGoogleAds() {
  const { isAnalyticsAllowed } = useConsent()
  if (!isAnalyticsAllowed()) return null
  return (
    <>
      <Script
        id="gtag-loader"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}
      />
      <Script
        id="gtag-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GOOGLE_ADS_ID}');
          `,
        }}
      />
    </>
  )
}
