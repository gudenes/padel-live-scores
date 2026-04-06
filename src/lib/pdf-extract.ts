// src/lib/pdf-extract.ts
// Extract text from PDF using Mistral's OCR API (document processing).
// Replaces pdf-parse which has compatibility issues on Vercel serverless.

/**
 * Extract all text content from a PDF file using Mistral's OCR endpoint.
 * Returns the raw text suitable for parsing by draw-parser or entry-list-parser.
 *
 * Requires MISTRAL_API_KEY env var.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('MISTRAL_API_KEY env var is not set')

  // Step 1: Upload the file to Mistral
  const blob = new Blob([data], { type: 'application/pdf' })
  const formData = new FormData()
  formData.append('file', blob, 'document.pdf')
  formData.append('purpose', 'ocr')

  const uploadResponse = await fetch('https://api.mistral.ai/v1/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!uploadResponse.ok) {
    const errorBody = await uploadResponse.text()
    throw new Error(`File upload failed: ${uploadResponse.status} ${errorBody}`)
  }

  const uploadResult = await uploadResponse.json()
  const fileId = uploadResult.id

  // Step 2: Get signed URL for the uploaded file
  const signedUrlResponse = await fetch(`https://api.mistral.ai/v1/files/${fileId}/url`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  })

  if (!signedUrlResponse.ok) {
    const errorBody = await signedUrlResponse.text()
    throw new Error(`Signed URL failed: ${signedUrlResponse.status} ${errorBody}`)
  }

  const signedUrlResult = await signedUrlResponse.json()
  const signedUrl = signedUrlResult.url

  // Step 3: Process with OCR
  const ocrResponse = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: {
        type: 'document_url',
        document_url: signedUrl,
      },
    }),
  })

  if (!ocrResponse.ok) {
    const errorBody = await ocrResponse.text()
    throw new Error(`OCR failed: ${ocrResponse.status} ${errorBody}`)
  }

  const ocrResult = await ocrResponse.json()

  // Extract text from all pages
  const pages = ocrResult.pages ?? []
  const text = pages
    .map((page: any) => page.markdown ?? '')
    .join('\n')

  // Step 4: Clean up - delete the uploaded file
  try {
    await fetch(`https://api.mistral.ai/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })
  } catch {
    // Cleanup failure is non-critical
  }

  return text
}
