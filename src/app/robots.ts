import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/ops/', '/auth/', '/x/'],
      },
    ],
    sitemap: 'https://padelnachos.com/sitemap.xml',
  }
}
