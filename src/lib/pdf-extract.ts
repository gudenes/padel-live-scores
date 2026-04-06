// src/lib/pdf-extract.ts
// Extract text from PDF using Mistral API (document/OCR support).
// Replaces pdf-parse which has compatibility issues on Vercel serverless.

/**
 * Extract all text content from a PDF file using Mistral's vision/document API.
 * Returns the raw text suitable for parsing by draw-parser or entry-list-parser.
 *
 * Requires MISTRAL_API_KEY env var.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('MISTRAL_API_KEY env var is not set')

  const base64 = Buffer.from(data).toString('base64')
  const dataUrl = `data:application/pdf;base64,${base64}`

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
              },
            },
            {
              type: 'text',
              text: 'Extract ALL text from this PDF exactly as it appears. Preserve the layout, line breaks, and spacing as closely as possible. Do not summarize, interpret, or modify the content in any way. Output only the raw text content, nothing else.',
            },
          ],
        },
      ],
      max_tokens: 8192,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`${response.status} ${errorBody}`)
  }

  const result = await response.json()
  const text = result.choices?.[0]?.message?.content ?? ''

  return text
}
