// src/lib/fip-event-page.ts
// Helpers for discovering entry-list PDFs on padelfip.com's WordPress event pages.
//
// Pipeline (verified live against FIP Bronze Ijuí 2026, April 2026):
//   1. GET /es/events/{fip_id}/ → HTML contains a nonce and a post_id
//   2. POST /wp-admin/admin-ajax.php with action=load_entrylist_tab + nonce + post_id
//      → JSON { success, data: { html } } where `html` embeds a JS `pdfMap`
//        containing per-gender PDF URLs
//   3. GET each PDF URL, feed the text into `parseEntryListText`
//
// Functions are deterministic and transport-free — the route handler composes
// them with a real fetch.

const FIP_BASE = 'https://www.padelfip.com'

export function buildEventPageUrl(fipId: string): string {
  return `${FIP_BASE}/es/events/${fipId}/`
}

export interface AjaxParams {
  nonce: string
  postId: string
}

/**
 * Extract the WordPress admin-ajax nonce and the event's WP post_id from the
 * event page HTML.
 *
 * The canonical pair appears in the `padelfip_ajax` global for the nonce and
 * in an inline handler invocation for the post_id. Both are short alphanumeric
 * tokens — the regex stays tight to avoid false positives from other inline
 * form nonces on the page.
 */
export function extractNonceAndPostId(html: string): AjaxParams | null {
  // The canonical location on modern FIP event pages is the padelfip_ajax
  // global, emitted inline like:
  //   padelfip_ajax = {"ajax_url":"...","nonce":"a3a100a4f2"};
  // The form field sent to admin-ajax is `security=<value>` but the VALUE
  // comes from the `nonce` key (this is WordPress's per-plugin convention —
  // other plugins like gallery_ajax emit a different nonce under a `security`
  // key that must NOT be used here).
  let nonce: string | null = null
  const padelfipAjaxRe = /padelfip_ajax\s*=\s*\{[^}]*?["']?nonce["']?\s*:\s*["']([a-z0-9]{6,20})["']/i
  const ajaxMatch = padelfipAjaxRe.exec(html)
  if (ajaxMatch) {
    nonce = ajaxMatch[1]
  } else {
    // Back-compat fallback: the "security"-keyed shape used by test fixtures
    // and older page layouts. Never grab the first "security":"..." blindly —
    // ensure it sits inside a padelfip_ajax or padelfip_* assignment to avoid
    // picking up unrelated per-action nonces (gallery, wpcf7, etc.).
    const scopedRe = /padelfip[a-z_]*\s*=\s*\{[^}]*?["']?(?:security|nonce)["']?\s*:\s*["']([a-z0-9]{6,20})["']/i
    const m = scopedRe.exec(html)
    if (m) nonce = m[1]
  }
  if (!nonce) return null

  // post_id: the value associated with the ajax call. Modern pages emit it as
  // data-post-id on a container div; older ones assign via post_id: 289421.
  // Accept quoted or unquoted numeric form.
  const postIdRe = /(?:data-post-id|["']?post_id["']?)\s*[:=]\s*["']?(\d{3,})/i
  const postIdMatch = postIdRe.exec(html)
  if (!postIdMatch) return null

  return { nonce, postId: postIdMatch[1] }
}

export interface EntryListPdfUrls {
  men?: string
  women?: string
}

/**
 * Parse the admin-ajax response body to extract per-gender PDF URLs from the
 * embedded `pdfMap` JavaScript object. The AJAX endpoint returns JSON with an
 * HTML blob in `data.html`; inside that blob is a `<script>` tag that declares
 * `pdfMap = {"M":{"":"<url>"},"W":{"":"<url>"}}`.
 *
 * Forward slashes in the URL are JSON-escaped (`\/`) by WordPress; we unescape
 * them during extraction.
 */
export function extractPdfUrlsFromAjaxResponse(responseBody: string): EntryListPdfUrls {
  // WordPress returns -1 on bad nonce; guard against that + non-JSON bodies
  if (!responseBody || responseBody.trim() === '-1') return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(responseBody)
  } catch {
    return {}
  }

  const html = (parsed as { data?: { html?: unknown } } | null)?.data?.html
  if (typeof html !== 'string') return {}

  // The pdfMap literal is embedded as JS inside the HTML string. The structure
  // is stable: `pdfMap = {"M":{"":"<escaped-url>", "u12":"...", ...}, "W":{...}}`.
  // We extract the first URL (the `""` key = main draw) for each gender.
  //
  // Match pattern: "M":{"":"<captured>", ...}
  const out: EntryListPdfUrls = {}
  const mMatch = /"M"\s*:\s*\{\s*""\s*:\s*"([^"]*)"/.exec(html)
  const wMatch = /"W"\s*:\s*\{\s*""\s*:\s*"([^"]*)"/.exec(html)
  const unescape = (s: string): string => s.replace(/\\\//g, '/')

  if (mMatch && mMatch[1]) {
    const url = unescape(mMatch[1])
    if (url) out.men = url
  }
  if (wMatch && wMatch[1]) {
    const url = unescape(wMatch[1])
    if (url) out.women = url
  }
  return out
}

export interface FetchEntryListParams {
  nonce: string
  postId: string
}

/** Build the admin-ajax request body for the entry-list tab loader. */
export function buildEntryListAjaxBody(params: FetchEntryListParams): string {
  const form = new URLSearchParams()
  form.set('action', 'load_entrylist_tab')
  form.set('security', params.nonce)
  form.set('post_id', params.postId)
  return form.toString()
}

export const ADMIN_AJAX_URL = `${FIP_BASE}/wp-admin/admin-ajax.php`
