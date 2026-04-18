// src/app/api/cron/editorial-gen/route.ts
// Daily cron — generates tournament previews and recaps via Claude.
//
// Schedule: 06:00 UTC daily (vercel.json).
// Windows:
//   - preview: tournaments STARTING in [today, today+7]
//   - recap:   tournaments ENDED in [today-7, today]
// Each (tournament, kind) gets one English post + four translations (es/pt/it/fr).
// Existing posts are never overwritten — delete the row manually to regenerate.
//
// Budget: Vercel Hobby = 60s. Each tournament = ~5 API calls (1 Opus + 4 Haiku).
// We cap at MAX_PER_RUN tournaments per run; the next day's run picks up the rest.

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { tokenize, isTokenSubset } from '@/lib/source-matcher'
import { generateEditorial, EDITORIAL_MODEL } from '@/lib/editorial-generator'
import { translateEditorial, TRANSLATOR_MODEL, type SupportedLocale } from '@/lib/editorial-translator'
import type {
  EditorialInput,
  EditorialOutput,
  PreviewInput,
  RecapInput,
  FinalInput,
  TournamentInput,
  PreviousEditionInput,
} from '@/lib/editorial-prompts'
import { countWords } from '@/lib/editorial-prompts'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_PER_RUN = 6
const TARGET_LOCALES: SupportedLocale[] = ['es', 'pt', 'it', 'fr']

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ─────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
  }

  const summary = {
    previewsGenerated: 0,
    recapsGenerated: 0,
    translationsGenerated: 0,
    skipped: 0,
    failed: 0,
    details: [] as Array<{ tournamentId: string; kind: string; status: string; note?: string }>,
  }

  const startedAt = Date.now()
  const deadline = startedAt + 55_000 // leave 5s headroom

  // ── Previews ──────────────────────────────────────────────────────
  const previewCandidates = await findPreviewCandidates()
  for (const t of previewCandidates) {
    if (Date.now() > deadline) { summary.details.push({ tournamentId: t.id, kind: 'preview', status: 'deadline' }); break }
    if (summary.previewsGenerated + summary.recapsGenerated >= MAX_PER_RUN) break

    try {
      const result = await generatePreviewForTournament(t.id)
      if (result === 'skipped') {
        summary.skipped++
        summary.details.push({ tournamentId: t.id, kind: 'preview', status: 'skipped', note: 'exists' })
      } else {
        summary.previewsGenerated++
        summary.translationsGenerated += result.translationsGenerated
        summary.details.push({ tournamentId: t.id, kind: 'preview', status: 'ok' })
      }
    } catch (err) {
      summary.failed++
      summary.details.push({
        tournamentId: t.id, kind: 'preview', status: 'failed',
        note: (err as Error).message,
      })
    }
  }

  // ── Recaps ────────────────────────────────────────────────────────
  const recapCandidates = await findRecapCandidates()
  for (const t of recapCandidates) {
    if (Date.now() > deadline) { summary.details.push({ tournamentId: t.id, kind: 'recap', status: 'deadline' }); break }
    if (summary.previewsGenerated + summary.recapsGenerated >= MAX_PER_RUN) break

    try {
      const result = await generateRecapForTournament(t.id)
      if (result === 'skipped') {
        summary.skipped++
        summary.details.push({ tournamentId: t.id, kind: 'recap', status: 'skipped', note: 'no finals in DB yet' })
      } else {
        summary.recapsGenerated++
        summary.translationsGenerated += result.translationsGenerated
        summary.details.push({ tournamentId: t.id, kind: 'recap', status: 'ok' })
      }
    } catch (err) {
      summary.failed++
      summary.details.push({
        tournamentId: t.id, kind: 'recap', status: 'failed',
        note: (err as Error).message,
      })
    }
  }

  return Response.json({
    success: true,
    elapsedMs: Date.now() - startedAt,
    ...summary,
  })
}

// ─────────────────────────────────────────────────────────────────────
// Candidate enumeration
// ─────────────────────────────────────────────────────────────────────

interface CandidateTournament {
  id: string
  name: string
  level: string | null
  country: string | null
  starts_at: string
  ends_at: string
  prize_money: string | null
}

async function findPreviewCandidates(): Promise<CandidateTournament[]> {
  const now = new Date()
  const sevenDays = new Date(now.getTime() + 7 * 86_400_000)

  const { data } = await supabase
    .from('tournaments')
    .select('id, name, level, country, starts_at, ends_at, prize_money')
    .gte('starts_at', now.toISOString())
    .lte('starts_at', sevenDays.toISOString())
    .in('level', ['major', 'finals', 'p1', 'p2', 'fip_gold']) // quality filter
    .order('starts_at', { ascending: true })
    .limit(20)

  const tournaments = (data as CandidateTournament[] | null) ?? []
  if (tournaments.length === 0) return []

  // Filter out tournaments that already have an English preview (en is the source of truth)
  const { data: existing } = await supabase
    .from('editorial_posts')
    .select('entity_id')
    .eq('entity_type', 'tournament')
    .eq('kind', 'preview')
    .eq('locale', 'en')
    .in('entity_id', tournaments.map(t => t.id))

  const hasEnglish = new Set((existing ?? []).map(e => e.entity_id))
  return tournaments.filter(t => !hasEnglish.has(t.id))
}

async function findRecapCandidates(): Promise<CandidateTournament[]> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)

  const { data } = await supabase
    .from('tournaments')
    .select('id, name, level, country, starts_at, ends_at, prize_money')
    .gte('ends_at', sevenDaysAgo.toISOString())
    .lt('ends_at', now.toISOString())
    .in('level', ['major', 'finals', 'p1', 'p2', 'fip_gold'])
    .order('ends_at', { ascending: false })
    .limit(20)

  const tournaments = (data as CandidateTournament[] | null) ?? []
  if (tournaments.length === 0) return []

  const { data: existing } = await supabase
    .from('editorial_posts')
    .select('entity_id')
    .eq('entity_type', 'tournament')
    .eq('kind', 'recap')
    .eq('locale', 'en')
    .in('entity_id', tournaments.map(t => t.id))

  const hasEnglish = new Set((existing ?? []).map(e => e.entity_id))
  return tournaments.filter(t => !hasEnglish.has(t.id))
}

// ─────────────────────────────────────────────────────────────────────
// Preview generation
// ─────────────────────────────────────────────────────────────────────

interface GenerationResult {
  translationsGenerated: number
}

async function generatePreviewForTournament(tournamentId: string): Promise<GenerationResult | 'skipped'> {
  const tournament = await loadTournament(tournamentId)
  if (!tournament) throw new Error(`Tournament not found: ${tournamentId}`)

  const previousEdition = await findPreviousEdition(tournament)

  const input: PreviewInput = {
    kind: 'preview',
    tournament: tournamentToInput(tournament),
    previousEdition,
    topMenSeeds: [],     // deferred for Wave 2 — draw data integration is a follow-up
    topWomenSeeds: [],
    totalMatches: null,
  }

  return await generateAndStore('preview', tournament.id, input)
}

// ─────────────────────────────────────────────────────────────────────
// Recap generation
// ─────────────────────────────────────────────────────────────────────

async function generateRecapForTournament(tournamentId: string): Promise<GenerationResult | 'skipped'> {
  const tournament = await loadTournament(tournamentId)
  if (!tournament) throw new Error(`Tournament not found: ${tournamentId}`)

  const finals = await loadFinals(tournament.id)
  const totalMatchesPlayed = await countFinishedMatches(tournament.id)

  // Skip if we have no finals data — Claude would have to invent the storyline
  if (!finals.menFinal && !finals.womenFinal) {
    return 'skipped'
  }

  const input: RecapInput = {
    kind: 'recap',
    tournament: tournamentToInput(tournament),
    menFinal: finals.menFinal,
    womenFinal: finals.womenFinal,
    notableMatches: [],  // deferred for Wave 2
    totalMatchesPlayed,
  }

  return await generateAndStore('recap', tournament.id, input)
}

// ─────────────────────────────────────────────────────────────────────
// Shared: generate English → translate → persist
// ─────────────────────────────────────────────────────────────────────

async function generateAndStore(
  kind: 'preview' | 'recap',
  tournamentId: string,
  input: EditorialInput,
): Promise<GenerationResult> {
  // 1. Generate English
  const en = await generateEditorial(input)

  const enRow = {
    entity_type: 'tournament',
    entity_id: tournamentId,
    kind,
    locale: 'en',
    headline: en.output.headline,
    lead: en.output.lead,
    body_md: en.output.body,
    callout_key: en.output.calloutKey,
    callout_value: en.output.calloutValue,
    word_count: countWords(en.output.body),
    source_snapshot: input,
    translated_from: null,
    model: en.model,
  }

  const { data: enInserted, error: enErr } = await supabase
    .from('editorial_posts')
    .insert(enRow)
    .select('id')
    .single()

  if (enErr || !enInserted) {
    throw new Error(`Failed to store English ${kind}: ${enErr?.message}`)
  }

  const sourceId = enInserted.id as string

  // 2. Translate to every locale in parallel, persist each
  const translationResults = await Promise.allSettled(
    TARGET_LOCALES.map(locale => translateAndStore(en.output, locale, sourceId, kind, tournamentId, input)),
  )

  const translationsGenerated = translationResults.filter(r => r.status === 'fulfilled').length
  const translationsFailed = translationResults.filter(r => r.status === 'rejected')
  if (translationsFailed.length > 0) {
    console.warn(`[editorial-gen] ${translationsFailed.length}/${TARGET_LOCALES.length} translations failed for ${tournamentId} ${kind}:`,
      translationsFailed.map(r => (r as PromiseRejectedResult).reason?.message))
  }

  return { translationsGenerated }
}

async function translateAndStore(
  source: EditorialOutput,
  locale: SupportedLocale,
  sourceId: string,
  kind: 'preview' | 'recap',
  tournamentId: string,
  input: EditorialInput,
): Promise<void> {
  const translated = await translateEditorial(source, locale)

  const { error } = await supabase
    .from('editorial_posts')
    .insert({
      entity_type: 'tournament',
      entity_id: tournamentId,
      kind,
      locale,
      headline: translated.output.headline,
      lead: translated.output.lead,
      body_md: translated.output.body,
      callout_key: translated.output.calloutKey,
      callout_value: translated.output.calloutValue,
      word_count: countWords(translated.output.body),
      source_snapshot: input,
      translated_from: sourceId,
      model: translated.model,
    })

  if (error) {
    throw new Error(`Failed to store ${locale} translation: ${error.message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// Data loaders
// ─────────────────────────────────────────────────────────────────────

async function loadTournament(id: string): Promise<CandidateTournament | null> {
  const { data } = await supabase
    .from('tournaments')
    .select('id, name, level, country, starts_at, ends_at, prize_money')
    .eq('id', id)
    .single()
  return (data as CandidateTournament | null) ?? null
}

function tournamentToInput(t: CandidateTournament): TournamentInput {
  return {
    id: t.id,
    name: t.name,
    level: t.level,
    country: t.country,
    startsAt: t.starts_at,
    endsAt: t.ends_at,
    prizeMoney: t.prize_money,
  }
}

/**
 * Find the previous edition of the same tournament using token-subset matching.
 * Returns the men's/women's champion pair from that edition if we have the data.
 */
async function findPreviousEdition(t: CandidateTournament): Promise<PreviousEditionInput | null> {
  if (!t.level || !t.starts_at) return null

  // Get candidates at the same level with end date before this tournament starts
  const { data: candidates } = await supabase
    .from('tournaments')
    .select('id, name, ends_at')
    .eq('level', t.level)
    .lt('ends_at', t.starts_at)
    .order('ends_at', { ascending: false })
    .limit(100)

  if (!candidates || candidates.length === 0) return null

  // Token-subset match
  const currentTokens = tokenize(t.name)
  if (currentTokens.length === 0) return null

  const previous = candidates.find((c: { id: string; name: string; ends_at: string }) => {
    return isTokenSubset(t.name, c.name) || isTokenSubset(c.name, t.name)
  })

  if (!previous) return null

  // Load men's + women's finals from the previous edition
  const finals = await loadFinals(previous.id)
  const year = new Date(previous.ends_at).getFullYear()

  return {
    year,
    menChampion: finals.menFinal ? finals.menFinal.winner : null,
    womenChampion: finals.womenFinal ? finals.womenFinal.winner : null,
  }
}

/**
 * Find the men's and women's Final matches for a tournament.
 * Returns null for a category when the final isn't in the DB.
 */
async function loadFinals(tournamentId: string): Promise<{
  menFinal: FinalInput | null
  womenFinal: FinalInput | null
}> {
  const { data } = await supabase
    .from('matches')
    .select(`
      id, round, category, winner_pair,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name),
      sets(set_number, set_score, pair1_games, pair2_games)
    `)
    .eq('tournament_id', tournamentId)
    .in('status', ['finished', 'retired', 'walkover'])
    .not('winner_pair', 'is', null)

  if (!data || data.length === 0) return { menFinal: null, womenFinal: null }

  type Row = typeof data[number]
  const isFinalRound = (round: string | null) =>
    round != null && /final/i.test(round) && !/semi|qtr|quarter|round/i.test(round)

  const toFinal = (m: Row): FinalInput | null => {
    const winnerPair = (m as unknown as { winner_pair: number }).winner_pair
    const mm = m as unknown as {
      round: string | null
      category: 'men' | 'women'
      pair1_player1: { name: string } | null
      pair1_player2: { name: string } | null
      pair2_player1: { name: string } | null
      pair2_player2: { name: string } | null
      sets: Array<{ set_number: number; set_score: string | null; pair1_games: number | null; pair2_games: number | null }>
    }
    const p1a = mm.pair1_player1?.name
    const p1b = mm.pair1_player2?.name
    const p2a = mm.pair2_player1?.name
    const p2b = mm.pair2_player2?.name
    if (!p1a || !p1b || !p2a || !p2b) return null

    const pair1 = { p1: p1a, p2: p1b }
    const pair2 = { p1: p2a, p2: p2b }
    const winner = winnerPair === 1 ? pair1 : pair2
    const loser = winnerPair === 1 ? pair2 : pair1

    const sets = [...mm.sets]
      .sort((a, b) => a.set_number - b.set_number)
      .map(s => s.set_score ?? `${s.pair1_games ?? '?'}-${s.pair2_games ?? '?'}`)

    return {
      category: mm.category,
      winner,
      loser,
      sets,
      round: mm.round ?? 'Final',
    }
  }

  const finals = data.filter((m) => {
    const r = (m as unknown as { round: string | null }).round
    return isFinalRound(r)
  })

  const menFinalRow = finals.find((m) => (m as unknown as { category: string }).category === 'men')
  const womenFinalRow = finals.find((m) => (m as unknown as { category: string }).category === 'women')

  return {
    menFinal: menFinalRow ? toFinal(menFinalRow) : null,
    womenFinal: womenFinalRow ? toFinal(womenFinalRow) : null,
  }
}

async function countFinishedMatches(tournamentId: string): Promise<number> {
  const { count } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('status', ['finished', 'retired', 'walkover'])
  return count ?? 0
}

// Keep the import for referencing Anthropic + models in logs (unused otherwise)
void Anthropic
void EDITORIAL_MODEL
void TRANSLATOR_MODEL
