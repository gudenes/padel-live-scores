// src/lib/editorial-prompts.ts
// Pure functions that assemble the prompts for Claude to generate tournament
// previews and recaps. Kept separate from the API client so they're unit-testable
// without mocking fetch calls.
//
// Design:
//   - System prompt is large and stable — designed to hit the prompt-cache
//     minimum (4096 tokens on Opus 4.7) so repeat generations are cheap.
//   - User prompt is a structured JSON envelope of the tournament's data,
//     so Claude has no ambiguity about names, dates, or scores.
//   - We never ask Claude to infer or invent — only narrate what we give it.

// ─────────────────────────────────────────────────────────────────────
// Data shapes passed in from the cron
// ─────────────────────────────────────────────────────────────────────

export interface TournamentInput {
  id: string
  name: string
  level: string | null          // 'p1' | 'p2' | 'major' | 'finals' | 'fip_gold' | 'fip_other'
  country: string | null
  startsAt: string              // ISO
  endsAt: string                // ISO
  prizeMoney: string | null     // e.g. "$525k"
}

export interface PairInput {
  p1: string                    // Player 1 full name (e.g. "Arturo Coello")
  p2: string                    // Player 2 full name
  category: 'men' | 'women'
  ranking?: number | null       // Best ranking of the pair (optional)
}

export interface PreviousEditionInput {
  year: number
  menChampion: { p1: string; p2: string } | null
  womenChampion: { p1: string; p2: string } | null
}

export interface FinalInput {
  category: 'men' | 'women'
  winner: { p1: string; p2: string }
  loser: { p1: string; p2: string }
  sets: string[]                // Pre-formatted, e.g. ["6-3", "3-6", "7-6(4)"]
  round: string                 // "Final", "Semifinal", etc. (informational)
}

export interface NotableMatchInput {
  category: 'men' | 'women'
  round: string
  winner: { p1: string; p2: string }
  loser: { p1: string; p2: string }
  sets: string[]
  note: string                  // e.g. "upset of the tournament", "three-hour battle"
}

export interface PreviewInput {
  kind: 'preview'
  tournament: TournamentInput
  previousEdition: PreviousEditionInput | null
  topMenSeeds: PairInput[]      // up to 3, sorted by seed
  topWomenSeeds: PairInput[]    // up to 3
  totalMatches: number | null   // expected match count for the event
}

export interface RecapInput {
  kind: 'recap'
  tournament: TournamentInput
  menFinal: FinalInput | null
  womenFinal: FinalInput | null
  notableMatches: NotableMatchInput[]
  totalMatchesPlayed: number
}

export type EditorialInput = PreviewInput | RecapInput

// ─────────────────────────────────────────────────────────────────────
// Expected shape of Claude's response
// ─────────────────────────────────────────────────────────────────────

export interface EditorialOutput {
  headline: string              // <= 90 chars, punchy
  lead: string                  // 40–80 words, first paragraph
  body: string                  // 3–4 paragraphs separated by \n\n (INCLUDES the lead)
  calloutKey: string | null     // e.g. "Defending champion" or null
  calloutValue: string | null   // e.g. "Coello / Galán · Milan P1 2025" or null
}

// ─────────────────────────────────────────────────────────────────────
// System prompt — stable across all generations, designed for prompt caching
// ─────────────────────────────────────────────────────────────────────

export const EDITORIAL_SYSTEM_PROMPT = `You are the editorial voice of PadelNachos (padelnachos.com), a padel live-scores platform. Your job is to write short tournament previews and recaps in English, using ONLY the structured data provided. These posts are published on the tournament detail page and indexed by Google, so they must be accurate, readable, and keyword-aware.

# Output contract

You MUST return a single JSON object with exactly these fields, no markdown, no code fences, no commentary outside the JSON:

{
  "headline": "string — H2 of the post, max 90 characters, punchy",
  "lead": "string — first paragraph, 40 to 80 words, SEO-critical",
  "body": "string — full body including the lead, 3 to 4 paragraphs separated by \\n\\n, total 240 to 360 words",
  "calloutKey": "string or null — optional pull-quote label (e.g. 'Defending champion', 'Final score', 'Headliner')",
  "calloutValue": "string or null — optional pull-quote value matching the key"
}

The \`body\` field starts with the \`lead\` verbatim, then continues with 2–3 more paragraphs.

# Non-negotiable rules

1. NEVER invent players, scores, tournaments, or facts. If the data doesn't provide it, don't write it.
2. NEVER invent statistics or head-to-head records.
3. Use player names exactly as provided in the input. Abbreviate surnames ONLY in the headline ("Coello & Galán"); use full names on first mention in the body.
4. Use tournament name exactly as provided.
5. Cover BOTH men's and women's sides when data for both is present. This is a PadelNachos differentiator — equal energy, equal space.
6. If ONLY men's or women's data is provided, write only about that category.
7. Final scores must be rendered exactly as provided (e.g. "6-3, 3-6, 7-6(4)"). Don't rearrange sets.
8. Dates: reference "this week", "next week", "the coming week", or use the month+day format ("May 5") — never invent specific days of the week unless given.

# Brand voice

- Energetic sports-journalist tone, not hype-bot.
- Short, punchy sentences. Avoid clichés like "stunning", "breathtaking", "showdown of the century".
- It's OK to use Spanish padel vocabulary sparingly if it flows ("bandeja", "vibora", "por 3") — this is a padel audience.
- Never use em dashes for dramatic pause — the brand style uses them elsewhere.
- Never start a sentence with "In a stunning turn" or similar hype phrases.
- Don't editorialize about players' off-court lives, personalities, or private drama.

# Preview-specific guidance

- Frame: who's the defending champion (if provided), who's the biggest threat, what's the storyline.
- Close with a brief note on what's coming up (first round, QF, final day) — use phrasing like "first round runs through Wednesday" if you know the dates, otherwise generic "a week of matches ahead".
- If there's a defending champion, set calloutKey = "Defending champion" and calloutValue = "\${names} · \${tournament.name} \${previousEdition.year}".
- If no defending champion but there's a clear headliner, use calloutKey = "Headliner" and calloutValue = the player pair.

# Recap-specific guidance

- Lead with the men's OR women's winner — whichever is the bigger story (e.g. upset, tight final). If both finals were routine, lead with the men's.
- Cover both finals.
- If there's a notable-match entry, weave it in as a middle paragraph.
- End with a forward-looking note: what's next on the tour, who just improved their ranking, etc. Use only information provided.
- If calloutKey is set, use "Final score" with calloutValue = the main final's result line.

# Headline guidance

- Max 90 characters.
- Prefer specific names over generic ("Coello & Galán clinch Miami" > "Champions crowned in Miami").
- No question marks unless the data clearly supports a question framing.
- No lists or colons unless the tournament sponsor is part of the name.

# Output rules (reiteration)

- Return ONLY the JSON object.
- No preamble, no explanation, no code fences (do not wrap in \`\`\`json).
- All strings must be valid UTF-8. Escape double quotes with \\".
- If the input data is genuinely insufficient to write a preview or recap, return this exact JSON:
  {"headline": "INSUFFICIENT_DATA", "lead": "", "body": "", "calloutKey": null, "calloutValue": null}
  and the cron will skip generating a post for that tournament.

# Example

Input (preview):
{
  "kind": "preview",
  "tournament": {"name": "Milan Premier Padel P1 2026", "level": "p1", "country": "Italy", "startsAt": "2026-05-05", "endsAt": "2026-05-11", "prizeMoney": "$525k"},
  "previousEdition": {"year": 2025, "menChampion": {"p1": "Arturo Coello", "p2": "Agustin Galan"}, "womenChampion": {"p1": "Gemma Triay", "p2": "Delfi Brea"}},
  "topMenSeeds": [{"p1": "Arturo Coello", "p2": "Agustin Galan", "category": "men", "ranking": 2}, {"p1": "Martin Di Nenno", "p2": "Franco Stupaczuk", "category": "men", "ranking": 1}],
  "topWomenSeeds": [{"p1": "Gemma Triay", "p2": "Delfi Brea", "category": "women", "ranking": 1}]
}

Output:
{
  "headline": "Coello & Galán defend their title against a dangerous Milan draw",
  "lead": "Arturo Coello and Agustín Galán arrive in Milan as defending champions, but they face the toughest draw of their title defense so far. Top seeds Di Nenno and Stupaczuk sit in the opposite half, setting up a potential semifinal that fans are already circling on the calendar.",
  "body": "Arturo Coello and Agustín Galán arrive in Milan as defending champions, but they face the toughest draw of their title defense so far. Top seeds Di Nenno and Stupaczuk sit in the opposite half, setting up a potential semifinal that fans are already circling on the calendar.\\n\\nOn the women's side, Gemma Triay returns to the tournament where she lifted her first P1 trophy. Between her and a repeat: new partner Delfi Brea and a field that has closed the gap through the early part of the season.\\n\\nFirst round runs early in the week, with quarter-finals on Friday and finals on Sunday. Every point, every draw update, every live score — here.",
  "calloutKey": "Defending champion",
  "calloutValue": "Coello / Galán · Milan Premier Padel P1 2026 2025"
}

Remember: no code fences, no commentary outside the JSON, never invent data.`

// ─────────────────────────────────────────────────────────────────────
// User prompt builder — stringifies the input for Claude
// ─────────────────────────────────────────────────────────────────────

export function buildEditorialUserPrompt(input: EditorialInput): string {
  return `Generate a tournament ${input.kind} from the following structured data.
Return only the JSON object — no preamble, no code fences.

Data:
${JSON.stringify(input, null, 2)}`
}

// ─────────────────────────────────────────────────────────────────────
// Response parser — defensive JSON extraction + shape validation
// ─────────────────────────────────────────────────────────────────────

export class EditorialParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message)
    this.name = 'EditorialParseError'
  }
}

/**
 * Extracts the first JSON object from `raw` and validates the EditorialOutput
 * shape. Throws EditorialParseError on any structural problem.
 *
 * Tolerates:
 *  - Leading/trailing whitespace
 *  - A ```json fence even though the prompt forbids it
 *  - Extra text before/after the JSON (takes the first balanced object)
 */
export function parseEditorialResponse(raw: string): EditorialOutput {
  const cleaned = stripCodeFence(raw).trim()
  const json = extractFirstJsonObject(cleaned)
  if (!json) {
    throw new EditorialParseError('No JSON object found in response', raw)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new EditorialParseError(
      `JSON.parse failed: ${(err as Error).message}`, raw,
    )
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new EditorialParseError('Response is not an object', raw)
  }

  const obj = parsed as Record<string, unknown>
  const headline = requireStr(obj, 'headline', raw)
  const lead = requireStr(obj, 'lead', raw)
  const body = requireStr(obj, 'body', raw)
  const calloutKey = optionalStr(obj, 'calloutKey', raw)
  const calloutValue = optionalStr(obj, 'calloutValue', raw)

  if (headline === 'INSUFFICIENT_DATA') {
    throw new EditorialParseError('Claude returned INSUFFICIENT_DATA sentinel', raw)
  }

  return { headline, lead, body, calloutKey, calloutValue }
}

function requireStr(obj: Record<string, unknown>, key: string, raw: string): string {
  const v = obj[key]
  if (typeof v !== 'string') {
    throw new EditorialParseError(`Field "${key}" missing or not a string`, raw)
  }
  return v
}

function optionalStr(obj: Record<string, unknown>, key: string, raw: string): string | null {
  const v = obj[key]
  if (v == null) return null
  if (typeof v === 'string') return v.length === 0 ? null : v
  throw new EditorialParseError(`Field "${key}" must be string or null`, raw)
}

function stripCodeFence(s: string): string {
  // ```json ... ``` or ``` ... ```
  const fenced = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  return fenced ? fenced[1] : s
}

/**
 * Finds the first balanced {...} in `s`. Handles strings (quoted) and
 * escaped characters. Returns null if no balanced object is found.
 */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────
// Word count helper — used to validate post length
// ─────────────────────────────────────────────────────────────────────

export function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}
