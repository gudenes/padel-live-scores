// In-memory per-tournament player dictionary for resolving abbreviated widget
// names like "J. Lebrón" → canonical FIP IDs. Built fresh per worker invocation.

export interface DictionaryPlayer {
  fipId: string;
  name: string;
  country: string | null;
  partnerFipId?: string | null;
  partnerName?: string | null;
}

export interface TournamentDictionary {
  players: Map<string, DictionaryPlayer>;          // fipId → player
  byNormalizedSurname: Map<string, string[]>;       // normalized surname → fipIds
  byNormalizedFullName: Map<string, string[]>;      // normalized full name → fipIds
}

export type ResolveConfidence = 'exact' | 'pair_disambiguated' | 'fuzzy' | 'unresolved';

export interface ResolveResult {
  fipId: string | null;
  confidence: ResolveConfidence;
  candidates: string[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSurname(name: string): string {
  // "J. Lebron" → "lebron"  |  "Juan Lebron" → "lebron"  |  "Lebron" → "lebron"
  const norm = normalize(name);
  const parts = norm.split(' ');
  return parts[parts.length - 1] ?? norm;
}

export function buildTournamentDictionary(players: DictionaryPlayer[]): TournamentDictionary {
  const byFip = new Map<string, DictionaryPlayer>();
  const bySurname = new Map<string, string[]>();
  const byFullName = new Map<string, string[]>();

  for (const p of players) {
    byFip.set(p.fipId, p);

    const surname = extractSurname(p.name);
    if (surname) {
      const arr = bySurname.get(surname) ?? [];
      arr.push(p.fipId);
      bySurname.set(surname, arr);
    }

    const fullName = normalize(p.name);
    if (fullName) {
      const arr = byFullName.get(fullName) ?? [];
      arr.push(p.fipId);
      byFullName.set(fullName, arr);
    }
  }

  return { players: byFip, byNormalizedSurname: bySurname, byNormalizedFullName: byFullName };
}

export function resolveShortName(
  dict: TournamentDictionary,
  shortName: string,
  partnerHint?: string
): ResolveResult {
  if (!shortName) return { fipId: null, confidence: 'unresolved', candidates: [] };

  const normFull = normalize(shortName);
  const surname = extractSurname(shortName);

  // 1. Try full name match
  const fullMatches = dict.byNormalizedFullName.get(normFull) ?? [];
  if (fullMatches.length === 1) {
    return { fipId: fullMatches[0]!, confidence: 'exact', candidates: fullMatches };
  }

  // 2. Try surname match
  const surnameMatches = dict.byNormalizedSurname.get(surname) ?? [];
  if (surnameMatches.length === 0) {
    return { fipId: null, confidence: 'unresolved', candidates: [] };
  }
  if (surnameMatches.length === 1) {
    return { fipId: surnameMatches[0]!, confidence: 'exact', candidates: surnameMatches };
  }

  // 3. Multiple surname matches — try partner disambiguation
  if (partnerHint) {
    const partnerSurname = extractSurname(partnerHint);
    for (const fipId of surnameMatches) {
      const player = dict.players.get(fipId);
      if (!player?.partnerName) continue;
      const dictPartnerSurname = extractSurname(player.partnerName);
      if (dictPartnerSurname === partnerSurname) {
        return { fipId, confidence: 'pair_disambiguated', candidates: surnameMatches };
      }
    }
  }

  // 4. Multiple matches, no disambiguation — unresolved with candidates list
  return { fipId: null, confidence: 'unresolved', candidates: surnameMatches };
}
