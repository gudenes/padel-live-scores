import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadConditionalPdfText } from '../lib/conditional-pdf.js';
import { pdfToText } from '../lib/pdf-text.js';
vi.mock('../lib/pdf-text.js', () => ({ pdfToText: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const url = 'https://www.padelfip.com/entry.pdf';
const response = (etag: string, data = 'pdf') => ({ status: 200, headers: { etag }, data: Buffer.from(data) });
describe('conditional entry-list PDFs', () => {
  it('revalidates unchanged content and reuses parsed text on 304', async () => {
    vi.mocked(pdfToText).mockResolvedValue('players');
    const http = { get: vi.fn().mockResolvedValueOnce(response('v1')).mockResolvedValueOnce({ status: 304, data: Buffer.alloc(0), headers: {} }) };
    expect(await downloadConditionalPdfText(http as any, url)).toBe('players');
    expect(await downloadConditionalPdfText(http as any, url)).toBe('players');
    expect(http.get.mock.calls[1][1].headers).toEqual({ 'If-None-Match': 'v1' });
    expect(pdfToText).toHaveBeenCalledTimes(1);
  });
  it('replaces cached players when the PDF changes', async () => {
    vi.mocked(pdfToText).mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    const http = { get: vi.fn().mockResolvedValueOnce(response('v1')).mockResolvedValueOnce(response('v2')).mockResolvedValueOnce({ status: 304 }) };
    await downloadConditionalPdfText(http as any, url);
    expect(await downloadConditionalPdfText(http as any, url)).toBe('new');
    expect(await downloadConditionalPdfText(http as any, url)).toBe('new');
    expect(http.get.mock.calls[2][1].headers).toEqual({ 'If-None-Match': 'v2' });
  });
  it('does not serve stale data on a failed request or poison validators on parse errors', async () => {
    vi.mocked(pdfToText).mockResolvedValueOnce('old').mockRejectedValueOnce(new Error('invalid pdf'));
    const http = { get: vi.fn().mockResolvedValueOnce(response('v1')).mockResolvedValueOnce(response('v2')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status: 304 }) };
    await downloadConditionalPdfText(http as any, url);
    await expect(downloadConditionalPdfText(http as any, url)).rejects.toThrow('invalid pdf');
    await expect(downloadConditionalPdfText(http as any, url)).rejects.toThrow('offline');
    expect(await downloadConditionalPdfText(http as any, url)).toBe('old');
    expect(http.get.mock.calls[3][1].headers).toEqual({ 'If-None-Match': 'v1' });
  });
  it('coalesces simultaneous downloads and supports Last-Modified', async () => {
    vi.mocked(pdfToText).mockResolvedValue('players');
    const http = { get: vi.fn().mockResolvedValueOnce({ status: 200, headers: { 'last-modified': 'Sat, 14 Nov 2026 05:54:27 GMT' }, data: Buffer.from('pdf') }).mockResolvedValueOnce({ status: 304 }) };
    await Promise.all([downloadConditionalPdfText(http as any, url), downloadConditionalPdfText(http as any, url)]);
    expect(http.get).toHaveBeenCalledTimes(1);
    await downloadConditionalPdfText(http as any, url);
    expect(http.get.mock.calls[1][1].headers).toHaveProperty('If-Modified-Since');
  });
});
