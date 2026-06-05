/**
 * /app — smart app-store redirect.
 *
 * One shareable link (https://padelnachos.com/app) that routes each visitor
 * by User-Agent:
 *   • iPhone / iPad / iPod → App Store
 *   • Android              → Google Play
 *   • desktop / unknown    → padelnachos.com (web app)
 *   • social link-preview crawlers (WhatsApp, iMessage, Slack, …) → an
 *     OG-tagged HTML card so shared links unfurl with a clean preview.
 *
 * Why a Route Handler (not a page.tsx): a 302 is the snappiest experience for
 * real users, and a bare redirect can't emit Open Graph tags. We resolve the
 * tension by branching on the crawler UA — bots get HTML with meta tags,
 * humans get the redirect. Single file, no client flash.
 *
 * iPad caveat: server-side UA sniffing can't read navigator.maxTouchPoints,
 * so modern iPads (which report a "Macintosh" UA) fall to the web app. The
 * crawler HTML below ships a client-side detector with buttons as a graceful
 * fallback for anyone who does land on the page.
 *
 * Edge-compatible: uses only Web Request/Response APIs (no Node built-ins).
 *
 * NOTE: this route lives OUTSIDE src/app/[locale], so next-intl must be told
 * to skip it — see the `/app` bypass clause in src/proxy.ts.
 */

import {
  classifyUserAgent,
  redirectTargetFor,
  IOS_APP_URL,
  ANDROID_APP_URL,
  WEB_APP_URL,
} from '@/lib/app-redirect'

// UA-dependent: must always run at request time, never prerendered/cached.
export const dynamic = 'force-dynamic'

const OG_TITLE = 'Get the Padel Nachos app'
const OG_DESCRIPTION =
  'Live padel scores, rankings, draws & highlights from Premier Padel and FIP — on iPhone and Android. Tap to install.'
const OG_IMAGE = `${WEB_APP_URL}/og-image.png`

function crawlerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${OG_TITLE}</title>
<meta name="description" content="${OG_DESCRIPTION}" />
<meta name="theme-color" content="#0A0A0A" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Padel Nachos" />
<meta property="og:url" content="${WEB_APP_URL}/app" />
<meta property="og:title" content="${OG_TITLE}" />
<meta property="og:description" content="${OG_DESCRIPTION}" />
<meta property="og:image" content="${OG_IMAGE}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${OG_TITLE}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${OG_TITLE}" />
<meta name="twitter:description" content="${OG_DESCRIPTION}" />
<meta name="twitter:image" content="${OG_IMAGE}" />
<link rel="canonical" href="${WEB_APP_URL}/app" />
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:1.5rem; padding:2rem;
    background:#0A0A0A; color:#fff; font-family:-apple-system,BlinkMacSystemFont,
    "Segoe UI",Roboto,Helvetica,Arial,sans-serif; text-align:center; }
  h1 { font-size:1.5rem; margin:0; }
  p { color:#a1a1aa; margin:0; max-width:32rem; }
  .stores { display:flex; gap:1rem; flex-wrap:wrap; justify-content:center; }
  a.store { display:inline-block; padding:0.85rem 1.4rem; border-radius:0.75rem;
    background:#6abf3a; color:#0A0A0A; font-weight:700; text-decoration:none; }
  a.web { color:#a1a1aa; text-decoration:underline; font-size:0.9rem; }
</style>
</head>
<body>
  <h1>${OG_TITLE}</h1>
  <p>${OG_DESCRIPTION}</p>
  <div class="stores">
    <a class="store" href="${IOS_APP_URL}">Download on the App Store</a>
    <a class="store" href="${ANDROID_APP_URL}">Get it on Google Play</a>
  </div>
  <a class="web" href="${WEB_APP_URL}">Continue to padelnachos.com</a>
  <script>
    // Client-side fallback for any human who lands here (e.g. JS-capable
    // preview-in-app browsers). Has access to maxTouchPoints, so it can
    // catch modern iPads that report a desktop UA.
    (function () {
      var ua = navigator.userAgent || '';
      var isIOS = /iphone|ipad|ipod/i.test(ua) ||
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
      var isAndroid = /android/i.test(ua);
      if (isIOS) location.replace(${JSON.stringify(IOS_APP_URL)});
      else if (isAndroid) location.replace(${JSON.stringify(ANDROID_APP_URL)});
    })();
  </script>
</body>
</html>`
}

export function GET(request: Request): Response {
  const platform = classifyUserAgent(request.headers.get('user-agent'))

  if (platform === 'crawler') {
    return new Response(crawlerHtml(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Previews can be cached by the unfurl service; keep it short so
        // copy/asset tweaks propagate within the hour.
        'cache-control': 'public, max-age=3600',
      },
    })
  }

  return Response.redirect(redirectTargetFor(platform), 302)
}
