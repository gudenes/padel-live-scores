import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/ops/', '/auth/'],
      },
    ],
    sitemap: 'https://padelnachos.com/sitemap.xml',
  }
}
