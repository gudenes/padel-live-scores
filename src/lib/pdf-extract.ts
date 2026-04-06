// src/lib/pdf-extract.ts
// Extract text from PDF using Claude API (PDF support).
// Replaces pdf-parse which has compatibility issues on Vercel serverless.

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

/**
 * Extract all text content from a PDF file using Claude's native PDF reading.
 * Returns the raw text suitable for parsing by draw-parser or entry-list-parser.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const base64 = Buffer.from(data).toString('base64')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          },
          {
            type: 'text',
            text: 'Extract ALL text from this PDF exactly as it appears. Preserve the layout, line breaks, and spacing as closely as possible. Do not summarize, interpret, or modify the content in any way. Output only the raw text content, nothing else.',
          },
        ],
      },
    ],
  })

  // Extract text from the response
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')

  return text
}
