export async function GET(request: Request) {
  const url = new URL(request.url)
  const src = url.searchParams.get('src')
  if (!src) return new Response('Missing src', { status: 400 })
  if (!src.startsWith('https://storage.googleapis.com/fantasypadeltour/')) {
    return new Response('Forbidden', { status: 403 })
  }
  try {
    const res = await fetch(src)
    if (!res.ok) return new Response('Not found', { status: 404 })
    const buffer = await res.arrayBuffer()
    return new Response(buffer, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'image/webp',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new Response('Failed to fetch image', { status: 500 })
  }
}
