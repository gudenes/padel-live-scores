import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Logger } from 'pino';

let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(logger: Logger): Promise<Browser> {
  if (browserPromise) return browserPromise;
  logger.info('Launching playwright chromium (one-time)');
  browserPromise = chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browserPromise;
}

export async function withPage<T>(
  logger: Logger,
  fn: (page: Page) => Promise<T>
): Promise<T> {
  const browser = await getBrowser(logger);
  const context: BrowserContext = await browser.newContext({
    userAgent: 'Padelgod-Scraper/0.2.0 (contact: ops@padelnachos.com)',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
    await context.close();
  }
}

export async function shutdownBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise;
  await b.close();
  browserPromise = null;
}
