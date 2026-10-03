export const runtime = 'nodejs'

// External rewrites forward Cloudflare headers to PostHog's CDN, which can
// reject the request with error 1000. Fetch public SDK assets with fresh headers.
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  if (!path.length || path.some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..')) {
    return new Response('Not found', { status: 404 })
  }
  const upstream = new URL(`/static/${path.join('/')}`, 'https://eu-assets.i.posthog.com')
  upstream.search = new URL(request.url).search
  try {
    const response = await fetch(upstream, {
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
      cache: 'no-store',
    })
    if (!response.ok) return new Response('Asset unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } })
    return new Response(response.body, {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/javascript',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response('Asset unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
