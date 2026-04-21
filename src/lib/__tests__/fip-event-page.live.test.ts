// Live integration tests: fetch the real Ijuí page + admin-ajax + verify the
// helpers correctly extract parameters and PDF URLs.
// Run with: LIVE=1 npx vitest run src/lib/__tests__/fip-event-page.live.test.ts

import { describe, it, expect } from 'vitest'
import {
  ADMIN_AJAX_URL,
  buildEntryListAjaxBody,
  buildEventPageUrl,
  extractNonceAndPostId,
  extractPdfUrlsFromAjaxResponse,
} from '../fip-event-page'

const describeLive = process.env.LIVE ? describe : describe.skip

describeLive('fip-event-page — live', () => {
  it('extracts nonce + post_id from the real Ijuí event page', async () => {
    const url = buildEventPageUrl('fip-bronze-ijui-2026')
    const res = await fetch(url)
    expect(res.ok).toBe(true)
    const html = await res.text()
    const params = extractNonceAndPostId(html)
    expect(params).not.toBeNull()
    expect(params!.nonce).toMatch(/^[a-f0-9]{8,20}$/)
    expect(params!.postId).toMatch(/^\d{3,}$/)
  })

  it('end-to-end: page → admin-ajax → pdfMap gives both Ijuí PDF URLs', async () => {
    const pageHtml = await fetch(buildEventPageUrl('fip-bronze-ijui-2026')).then(r => r.text())
    const params = extractNonceAndPostId(pageHtml)
    expect(params).not.toBeNull()

    const ajaxRes = await fetch(ADMIN_AJAX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildEntryListAjaxBody(params!),
    })
    expect(ajaxRes.ok).toBe(true)
    const body = await ajaxRes.text()
    const pdfs = extractPdfUrlsFromAjaxResponse(body)
    expect(pdfs.men).toMatch(/Entry-List.*\.pdf$/i)
    expect(pdfs.women).toMatch(/Entry-List.*\.pdf$/i)
  })
})
