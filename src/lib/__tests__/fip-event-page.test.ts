import { describe, it, expect } from 'vitest'
import {
  extractNonceAndPostId,
  extractPdfUrlsFromAjaxResponse,
  buildEventPageUrl,
} from '../fip-event-page'

describe('buildEventPageUrl', () => {
  it('constructs the Spanish event URL from a fip_id', () => {
    expect(buildEventPageUrl('fip-bronze-ijui-2026'))
      .toBe('https://www.padelfip.com/es/events/fip-bronze-ijui-2026/')
  })

  it('preserves the fip- prefix in the slug', () => {
    // The URL keeps the full fip_id, it isn't stripped
    expect(buildEventPageUrl('fip-silver-mendoza-2026'))
      .toBe('https://www.padelfip.com/es/events/fip-silver-mendoza-2026/')
  })
})

describe('extractNonceAndPostId', () => {
  it('extracts both values from the canonical padelfip_ajax + data-post-id shape', () => {
    // Real shape observed on FIP event pages (April 2026):
    //   padelfip_ajax = {"ajax_url":"...","nonce":"<value>"}
    //   <div data-post-id="289421">...
    const html = `
      <html>
      <body>
      <div id="entrylist-ajax-container" data-post-id="289421"></div>
      <script>
        padelfip_ajax = {"ajax_url":"https:\\/\\/www.padelfip.com\\/wp-admin\\/admin-ajax.php","nonce":"a3a100a4f2"};
      </script>
      </body>
      </html>
    `
    expect(extractNonceAndPostId(html)).toEqual({ nonce: 'a3a100a4f2', postId: '289421' })
  })

  it('returns null when nonce missing', () => {
    const html = '<div data-post-id="12345"></div>'
    expect(extractNonceAndPostId(html)).toBeNull()
  })

  it('returns null when post_id missing', () => {
    const html = '<script>padelfip_ajax = { nonce: "abc12345" };</script>'
    expect(extractNonceAndPostId(html)).toBeNull()
  })

  it('ignores unrelated nonces from other plugins (gallery_params, wpcf7, etc.)', () => {
    // Other plugins on the page emit `security:` under different globals.
    // They must NOT be picked up — admin-ajax will 403 with the wrong nonce.
    const html = `
      <script>gallery_params = {"post_id":289421,"security":"5537308682"};</script>
      <script>wpcf7 = {"security":"deadbeef99"};</script>
      <script>padelfip_ajax = {"ajax_url":"/wp-admin/admin-ajax.php","nonce":"a3a100a4f2"};</script>
      <div data-post-id="289421"></div>
    `
    expect(extractNonceAndPostId(html)?.nonce).toBe('a3a100a4f2')
  })

  it('accepts the legacy "security" key when scoped under a padelfip_* global', () => {
    // Older page layouts: padelfip_ajax = {security: "..."}. Still preferred
    // over bare "security":"..." in random blocks.
    const html = `
      <script>padelfip_ajax = { security: "fedcba9876" };</script>
      <div data-post-id="4242"></div>
    `
    expect(extractNonceAndPostId(html)).toEqual({ nonce: 'fedcba9876', postId: '4242' })
  })
})

describe('extractPdfUrlsFromAjaxResponse', () => {
  const AJAX_BODY_WITH_BOTH = {
    success: true,
    data: {
      html: `<div id="entryListWrapper">...</div>
<script>
(function () {
  var pdfMap = {"M":{"":"https:\\/\\/www.padelfip.com\\/wp-content\\/uploads\\/2025\\/12\\/Entry-List-Fip-Bronze-Ijui-M-v2.pdf","u12":"","u14":""},"W":{"":"https:\\/\\/www.padelfip.com\\/wp-content\\/uploads\\/2025\\/12\\/Entry-List-Fip-Bronze-Ijui-W-v2.pdf","u12":"","u14":""}};
  var hasPdfGender = { M: true, W: true };
})();
</script>`,
    },
  }

  it('extracts both men and women PDF URLs from the embedded JS pdfMap', () => {
    const out = extractPdfUrlsFromAjaxResponse(JSON.stringify(AJAX_BODY_WITH_BOTH))
    expect(out).toEqual({
      men: 'https://www.padelfip.com/wp-content/uploads/2025/12/Entry-List-Fip-Bronze-Ijui-M-v2.pdf',
      women: 'https://www.padelfip.com/wp-content/uploads/2025/12/Entry-List-Fip-Bronze-Ijui-W-v2.pdf',
    })
  })

  it('returns an object with only the present gender', () => {
    const body = JSON.stringify({
      success: true,
      data: { html: `<script>
        var pdfMap = {"M":{"":"https:\\/\\/example.com\\/M.pdf"},"W":{"":""}};
        var hasPdfGender = { M: true, W: false };
      </script>` },
    })
    const out = extractPdfUrlsFromAjaxResponse(body)
    expect(out).toEqual({ men: 'https://example.com/M.pdf' })
  })

  it('returns an empty object when pdfMap has no real URLs', () => {
    const body = JSON.stringify({
      success: true,
      data: { html: `<script>var pdfMap = {"M":{"":""},"W":{"":""}};</script>` },
    })
    expect(extractPdfUrlsFromAjaxResponse(body)).toEqual({})
  })

  it('returns empty object when input is not a valid ajax response', () => {
    expect(extractPdfUrlsFromAjaxResponse('-1')).toEqual({})
    expect(extractPdfUrlsFromAjaxResponse('garbage')).toEqual({})
    expect(extractPdfUrlsFromAjaxResponse('{}')).toEqual({})
  })

  it('unescapes JSON-encoded forward slashes', () => {
    // WordPress's JSON-encoded strings double-escape `/` as `\/`. Extract must
    // normalize to valid URLs.
    const body = JSON.stringify({
      success: true,
      data: { html: `<script>var pdfMap = {"M":{"":"https:\\/\\/a.com\\/b\\/c.pdf"}};</script>` },
    })
    const out = extractPdfUrlsFromAjaxResponse(body)
    expect(out.men).toBe('https://a.com/b/c.pdf')
  })
})
