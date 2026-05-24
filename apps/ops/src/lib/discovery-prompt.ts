export const SYSTEM_PROMPT_DISCOVERY = `You are helping a padel news aggregator (padelnachos.com) find new sources for its catalog.

Use web search to find padel news sites the user doesn't already cover. For each candidate, return a JSON array with this shape:

[{ "url": "https://...", "name": "Site name", "language": "es", "rationale": "Why this is a good source" }]

Constraints — only return sites that:
- Publish padel-related content at least weekly
- Are reputable (not spam, link farms, or dead/abandoned domains)
- Have a discoverable feed, /feed/, /rss/, /wp-json, or a section page we can scrape
- Are NOT social media platforms (Twitter/X, Instagram, TikTok, YouTube)
- Are NOT already in the user's existing source list

Output ONLY the JSON array — no prose, no markdown. If you find fewer than the maximum, return what you have.`

export type DiscoveryFocus = 'broad' | 'spanish' | 'italian' | 'french' | 'portuguese' | 'brand' | 'press' | 'custom'

interface BuildOpts {
  focus: DiscoveryFocus
  customQuery?: string
  maxCandidates: number
  existing: Array<{ key: string; name: string; url: string }>
}

const FOCUS_PRESETS: Record<Exclude<DiscoveryFocus, 'custom'>, string> = {
  broad: 'Find any padel news sites — sport-specific or general sports outlets with active padel coverage.',
  spanish: 'Focus on Spanish-language padel sites — .es domains, Argentinian (.com.ar), Mexican (.mx). Major Spanish sports dailies (Marca, AS, Mundo Deportivo, Sport, Relevo) often have padel sections.',
  italian: 'Focus on Italian-language padel sites — .it domains. Federazione Italiana Tennis e Padel, Sky Sport Italia, Corriere dello Sport padel sections.',
  french: 'Focus on French-language padel sites — .fr domains. Federation Francaise de Tennis, L Equipe padel sections.',
  portuguese: 'Focus on Portuguese-language padel sites — .pt and .com.br domains.',
  brand: 'Focus on padel brand & equipment news — racket manufacturer blogs (Bullpadel, Head, Adidas, Wilson, Babolat, Nox), equipment reviews, retail sites with blogs.',
  press: 'Focus on official tour press release sources — Premier Padel, FIP (International Padel Federation), national federations.',
}

export function buildDiscoveryPrompt(opts: BuildOpts): string {
  const focusLine = opts.focus === 'custom'
    ? (opts.customQuery ?? 'Find broadly relevant padel sources.')
    : FOCUS_PRESETS[opts.focus]

  const existingList = opts.existing.length
    ? opts.existing.map(s => `  - ${s.name} (${s.url})`).join('\n')
    : '  (none yet)'

  return `Find up to ${opts.maxCandidates} new padel news sources.

Focus: ${focusLine}

Existing sources we already ingest — do NOT return these:
${existingList}

Return a JSON array of up to ${opts.maxCandidates} candidates.`
}
