// src/lib/ad-preview.ts
// Pure helper for the ad-banner preview-link feature. Framework-free so it's
// trivially unit-testable; the useAdPreview hook consumes it.

/** sessionStorage key the preview id is persisted under for the session. */
export const AD_PREVIEW_STORAGE_KEY = 'ad_preview'

/**
 * Decide the active preview banner id. A fresh ?ad_preview=<id> in the URL wins;
 * else the value persisted for the session; else null. Empty / whitespace is
 * treated as "no preview".
 */
export function pickPreviewId(
  fromUrl: string | null,
  fromStorage: string | null,
): string | null {
  const url = (fromUrl ?? '').trim()
  if (url) return url
  const stored = (fromStorage ?? '').trim()
  return stored || null
}
