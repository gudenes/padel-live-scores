// Decode HTML entities that arrive in FIP WordPress payloads.
//
// The FIP WP API returns text fields (event titles, overview blocks) in
// `*.rendered` form with entities still encoded — e.g. an en-dash comes
// through as `&#8211;`, an ampersand as `&amp;`. Stored raw, these render
// literally in the UI ("Castellón &#8211;"). Decode at the parser boundary
// so the DB only ever holds clean text.

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&apos;/g, "'")
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&Ntilde;/g, 'Ñ')
    .replace(/&oacute;/g, 'ó')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&uacute;/g, 'ú')
    .replace(/&aacute;/g, 'á');
}
