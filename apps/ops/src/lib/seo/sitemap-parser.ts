// apps/ops/src/lib/seo/sitemap-parser.ts
// Pure XML parsing for sitemap.xml. Avoids the xml2js / fast-xml-parser
// dep — our schema is fixed and the regex approach is fine for it.

export interface ParsedSitemap {
  kind: 'index' | 'urlset' | 'unknown'
  urls: string[]
}

function unescape(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function parseSitemapXml(xml: string): ParsedSitemap {
  const isIndex = /<sitemapindex[\s>]/i.test(xml)
  const isUrlset = /<urlset[\s>]/i.test(xml)
  if (!isIndex && !isUrlset) return { kind: 'unknown', urls: [] }

  const urls: string[] = []
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    urls.push(unescape(m[1].trim()))
  }
  return { kind: isIndex ? 'index' : 'urlset', urls }
}
