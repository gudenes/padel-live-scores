// src/lib/pdf-extract-claude.ts
// Extract text from PDF using Claude's native document reading.
// Claude can read PDFs directly via the document content block.

import Anthropic from '@anthropic-ai/sdk'

/**
 * Extract all text content from a PDF using Claude's document understanding.
 * Returns raw text preserving the table/list structure for entry-list-parser.
 *
 * Requires ANTHROPIC_API_KEY env var.
 */
export async function extractPdfTextClaude(data: Uint8Array): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const base64 = Buffer.from(data).toString('base64')

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
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
            text: `Extract ALL text content from this PDF exactly as it appears. Preserve the original layout, spacing, and structure. Include every number, name, country code, and ranking. Do NOT summarize, interpret, or reformat — output the raw text line by line. This is a padel tournament entry list or draw document.`,
          },
        ],
      },
    ],
  })

  // Extract text from response
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')

  if (!text.trim()) {
    throw new Error('Claude returned no text from PDF')
  }

  return text
}
