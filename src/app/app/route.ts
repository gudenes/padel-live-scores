/**
 * /app — smart app-store redirect (localised).
 *
 * One shareable link (https://padelnachos.com/app) that routes each visitor
 * by User-Agent:
 *   • iPhone / iPad / iPod → App Store
 *   • Android              → Google Play
 *   • desktop / unknown    → padelnachos.com (locale-prefixed web app)
 *   • social link-preview crawlers (WhatsApp, iMessage, Slack, …) → an
 *     OG-tagged HTML card so shared links unfurl with a clean preview.
 *
 * Why a Route Handler (not a page.tsx): a 302 is the snappiest experience for
 * real users, and a bare redirect can't emit Open Graph tags. We resolve the
 * tension by branching on the crawler UA — bots get HTML with meta tags,
 * humans get the redirect. Single file, no client flash.
 *
 * Language: `?lang=` query param wins, then Accept-Language, then English.
 * Because WhatsApp/iMessage cache one preview per URL (without the
 * recipient's locale), the per-language URL is the *reliable* way to force a
 * card language — share https://padelnachos.com/app?lang=pt into Brazilian
 * groups, ?lang=es into Spanish groups, etc. `pt` is Brazilian Portuguese.
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
  pickLocale,
  redirectTargetFor,
  APP_MESSAGES,
  IOS_APP_URL,
  ANDROID_APP_URL,
  WEB_APP_URL,
  type Locale,
} from '@/lib/app-redirect'

// UA- and locale-dependent: must always run at request time, never cached.
export const dynamic = 'force-dynamic'

const OG_IMAGE = `${WEB_APP_URL}/og-image.png`

function crawlerHtml(locale: Locale, shareUrl: string): string {
  const t = APP_MESSAGES[locale]
  const webHref = redirectTargetFor('desktop', locale)
  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t.title}</title>
<meta name="description" content="${t.description}" />
<meta name="theme-color" content="#0A0A0A" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Padel Nachos" />
<meta property="og:locale" content="${t.ogLocale}" />
<meta property="og:url" content="${shareUrl}" />
<meta property="og:title" content="${t.title}" />
<meta property="og:description" content="${t.description}" />
<meta property="og:image" content="${OG_IMAGE}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${t.title}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t.title}" />
<meta name="twitter:description" content="${t.description}" />
<meta name="twitter:image" content="${OG_IMAGE}" />
<link rel="canonical" href="${shareUrl}" />
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
  <h1>${t.title}</h1>
  <p>${t.description}</p>
  <div class="stores">
    <a class="store" href="${IOS_APP_URL}">${t.ios}</a>
    <a class="store" href="${ANDROID_APP_URL}">${t.android}</a>
  </div>
  <a class="web" href="${webHref}">${t.web}</a>
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
  const url = new URL(request.url)
  const locale = pickLocale(
    url.searchParams.get('lang'),
    request.headers.get('accept-language'),
  )
  const platform = classifyUserAgent(request.headers.get('user-agent'))

  if (platform === 'crawler') {
    // Reflect the requested language in the canonical/og:url so each
    // ?lang= variant is its own preview-cacheable resource.
    const langParam = url.searchParams.get('lang')
    const shareUrl = langParam
      ? `${WEB_APP_URL}/app?lang=${encodeURIComponent(langParam)}`
      : `${WEB_APP_URL}/app`
    return new Response(crawlerHtml(locale, shareUrl), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Vary on Accept-Language so a CDN can't serve a cached card in the
        // wrong language to a no-?lang request. Short TTL for copy tweaks.
        'cache-control': 'public, max-age=3600',
        vary: 'User-Agent, Accept-Language',
      },
    })
  }

  return Response.redirect(redirectTargetFor(platform, locale), 302)
}
