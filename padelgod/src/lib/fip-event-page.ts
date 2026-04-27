// padelgod/src/lib/fip-event-page.ts
//
// Helpers for discovering entry-list PDF URLs on padelfip.com event pages.
// Mirrors src/lib/fip-event-page.ts in the main repo (the manual ops upload
// flow uses the same logic). Pure functions — no I/O — so the worker can
// inject its own AxiosInstance for retries / timeouts.
//
// Pipeline:
//   1. GET /es/events/{slug}/ → HTML contains nonce + post_id
//   2. POST /wp-admin/admin-ajax.php with action=load_entrylist_tab + nonce
//      → JSON { success, data: { html } } where `html` embeds a JS pdfMap
//        with per-gender PDF URLs
//   3. GET each PDF URL, feed bytes to pdf-parse, then parseEntryListText.

const FIP_BASE = 'https://www.padelfip.com';

export const ADMIN_AJAX_URL = `${FIP_BASE}/wp-admin/admin-ajax.php`;

export function buildEventPageUrl(slug: string): string {
  return `${FIP_BASE}/es/events/${slug}/`;
}

export interface AjaxParams {
  nonce: string;
  postId: string;
}

export function extractNonceAndPostId(html: string): AjaxParams | null {
  let nonce: string | null = null;
  const padelfipAjaxRe =
    /padelfip_ajax\s*=\s*\{[^}]*?["']?nonce["']?\s*:\s*["']([a-z0-9]{6,20})["']/i;
  const ajaxMatch = padelfipAjaxRe.exec(html);
  if (ajaxMatch) {
    nonce = ajaxMatch[1] ?? null;
  } else {
    const scopedRe =
      /padelfip[a-z_]*\s*=\s*\{[^}]*?["']?(?:security|nonce)["']?\s*:\s*["']([a-z0-9]{6,20})["']/i;
    const m = scopedRe.exec(html);
    if (m) nonce = m[1] ?? null;
  }
  if (!nonce) return null;

  const postIdRe = /(?:data-post-id|["']?post_id["']?)\s*[:=]\s*["']?(\d{3,})/i;
  const postIdMatch = postIdRe.exec(html);
  if (!postIdMatch) return null;

  return { nonce, postId: postIdMatch[1]! };
}

export interface EntryListPdfUrls {
  men?: string;
  women?: string;
}

export function extractPdfUrlsFromAjaxResponse(responseBody: string): EntryListPdfUrls {
  if (!responseBody || responseBody.trim() === '-1') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return {};
  }

  const html = (parsed as { data?: { html?: unknown } } | null)?.data?.html;
  if (typeof html !== 'string') return {};

  const out: EntryListPdfUrls = {};
  const mMatch = /"M"\s*:\s*\{\s*""\s*:\s*"([^"]*)"/.exec(html);
  const wMatch = /"W"\s*:\s*\{\s*""\s*:\s*"([^"]*)"/.exec(html);
  const unescape = (s: string): string => s.replace(/\\\//g, '/');

  if (mMatch && mMatch[1]) {
    const url = unescape(mMatch[1]);
    if (url) out.men = url;
  }
  if (wMatch && wMatch[1]) {
    const url = unescape(wMatch[1]);
    if (url) out.women = url;
  }
  return out;
}

export function buildEntryListAjaxBody(params: AjaxParams): string {
  const form = new URLSearchParams();
  form.set('action', 'load_entrylist_tab');
  form.set('security', params.nonce);
  form.set('post_id', params.postId);
  return form.toString();
}
