// padelgod/src/lib/pdf-text.ts
//
// Single-purpose wrapper over pdf-parse v2 so the rest of the codebase
// (workers, tests) can stay decoupled from the library's class-based
// API. Tests mock this module instead of pdf-parse internals.

import { PDFParse } from 'pdf-parse';

/** Extract concatenated plain text from a PDF buffer. */
export async function pdfToText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}
