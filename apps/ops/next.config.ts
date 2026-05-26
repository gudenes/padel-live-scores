import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pdf-parse', 'sharp'],
  turbopack: { root: dirname },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
  },
  // The OCR snapshot-detail route reads calibration JSONs at runtime via
  // fs.readFile from `calibrations/` (populated by predev/prebuild script
  // scripts/sync-ocr-calibrations.mjs). The path doesn't appear as a literal
  // import in the route source, so Next's automatic tracer can miss it on
  // Vercel — make the include explicit. Source of truth still lives in
  // apps/ocr-worker/calibrations/; the local copy is gitignored.
  outputFileTracingIncludes: {
    '/api/internal/ocr-snapshot/*': ['calibrations/*.json'],
  },
}

export default nextConfig
