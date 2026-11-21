import type { AxiosInstance } from 'axios';
import { pdfToText } from './pdf-text.js';

interface Entry { text: string; etag?: string; modified?: string; bytes: number }
interface Cache { entries: Map<string, Entry>; pending: Map<string, Promise<string>>; bytes: number }
// Scope validators to the client; bound both URL count and retained text size.
// This cache intentionally revalidates every call and never serves stale on error.
const caches = new WeakMap<AxiosInstance, Cache>();
const MAX_ENTRIES = 128;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

export async function downloadConditionalPdfText(http: AxiosInstance, url: string): Promise<string> {
  let cache = caches.get(http);
  if (!cache) { cache = { entries: new Map(), pending: new Map(), bytes: 0 }; caches.set(http, cache); }
  const running = cache.pending.get(url);
  if (running) return running;
  const state = cache;
  const task = (async () => {
    const previous = state.entries.get(url);
    const headers: Record<string, string> = {};
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    else if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
    const response = await http.get(url, { responseType: 'arraybuffer', headers });
    if (response.status === 304) {
      if (!previous) throw new Error('FIP returned an unrequested PDF 304');
      state.entries.delete(url); state.entries.set(url, previous);
      return previous.text;
    }
    const text = await pdfToText(Buffer.from(response.data));
    const etag = response.headers?.etag;
    const modified = response.headers?.['last-modified'];
    if (previous) { state.entries.delete(url); state.bytes -= previous.bytes; }
    const bytes = Buffer.byteLength(text);
    // No validator means no bandwidth benefit from retaining the parsed text.
    if ((etag || modified) && bytes <= MAX_TEXT_BYTES) {
      while (state.entries.size >= MAX_ENTRIES || state.bytes + bytes > MAX_TEXT_BYTES) {
        const oldest = state.entries.keys().next().value!;
        state.bytes -= state.entries.get(oldest)!.bytes; state.entries.delete(oldest);
      }
      state.entries.set(url, { text, etag, modified, bytes }); state.bytes += bytes;
    }
    return text;
  })();
  state.pending.set(url, task);
  try { return await task; } finally { state.pending.delete(url); }
}
