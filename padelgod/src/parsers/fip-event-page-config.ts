/**
 * Extracts the WordPress AJAX config from a padelfip.com event page HTML body.
 *
 * The page embeds two inline <script> blocks with the parameters the
 * front-end needs to POST to `/wp-admin/admin-ajax.php`:
 *
 *   var padelfip_ajax = {"ajax_url":"…","nonce":"bd62b75983"};
 *   var ajax_object   = {"ajax_url":"…","post_id":"290219"};
 *
 * The `nonce` is a WordPress REST nonce (short-lived — typically 12–24h),
 * so the fetcher has to re-fetch the event page on every run. The
 * `post_id` is the WP post ID for the event and is effectively permanent
 * once assigned, but we capture it from the page anyway so we never
 * hardcode per-tournament IDs.
 *
 * Returns `null` if either field is missing — the caller should treat
 * that as a parse failure for that specific tournament (likely a page
 * redesign) and log it without killing the whole worker run.
 */

export interface FipEventPageConfig {
  ajaxUrl: string;
  nonce: string;
  postId: string;
}

export function parseFipEventPageConfig(html: string): FipEventPageConfig | null {
  // Match the full `var padelfip_ajax = {...};` JSON literal. We use a
  // lazy `.*?` up to the closing `}` — padelfip_ajax is a flat object
  // with no nested braces in practice.
  const padelfipMatch = html.match(/var\s+padelfip_ajax\s*=\s*(\{[^}]*\})/);
  const ajaxObjectMatch = html.match(/var\s+ajax_object\s*=\s*(\{[^}]*\})/);
  if (!padelfipMatch || !ajaxObjectMatch) return null;

  let padelfipJson: Record<string, string>;
  let ajaxObjectJson: Record<string, string>;
  try {
    padelfipJson = JSON.parse(padelfipMatch[1]!);
    ajaxObjectJson = JSON.parse(ajaxObjectMatch[1]!);
  } catch {
    return null;
  }

  const ajaxUrl = padelfipJson['ajax_url'] ?? ajaxObjectJson['ajax_url'];
  const nonce = padelfipJson['nonce'];
  const postId = ajaxObjectJson['post_id'];

  if (!ajaxUrl || !nonce || !postId) return null;
  return { ajaxUrl, nonce, postId };
}
