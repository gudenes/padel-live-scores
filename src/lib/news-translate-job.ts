// src/lib/news-translate-job.ts
// Orchestrates translation of a published EN news post to ES/PT/IT/FR.
// Replaces existing translation rows for that EN post (slug stickiness
// preserves URLs — see spec §6).

import type { NewsPost } from '@/types/news'

export async function translateAndStore(_enPost: NewsPost): Promise<{
  succeeded: string[]
  failed: { locale: string; error: string }[]
}> {
  throw new Error('translateAndStore not yet implemented')
}

export async function translateOneLocale(_enPostId: string, _locale: 'es' | 'pt' | 'it' | 'fr'): Promise<void> {
  throw new Error('translateOneLocale not yet implemented')
}
