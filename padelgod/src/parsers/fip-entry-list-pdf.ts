// padelgod/src/parsers/fip-entry-list-pdf.ts
//
// Pure parser for FIP entry-list PDF text. Mirrors src/lib/entry-list-parser.ts
// in the main repo so padelgod can run the same logic on Railway without
// reaching across packages. Drift between the two is policed by the unit
// tests in src/lib/__tests__/entry-list-parser.test.ts (main repo) and the
// padelgod-side tests under src/__tests__/parsers/.
//
// PDF structure (verified live on FIP Bronze Ijuí 2026, Apr 2026):
//   1. Main Draw teams (positions 1..N)
//   2. "QUALIFICATIONS" header (men) OR a second "Pos Ranking" header (women)
//   3. Qualifying teams (positions restart at 1)
//
// Wild Card entries are tagged "WC" between position and ranking:
//   "27 WC 1364 Dmitry Myagkov RUS"

export interface ParsedEntryPlayer {
  name: string;
  country: string;
  ranking: number;
  points: number;
}

export type DrawType = 'main' | 'qualifying';

export interface ParsedTeam {
  position: number;
  teamPoints: number;
  drawType: DrawType;
  isWildCard: boolean;
  player1: ParsedEntryPlayer;
  player2: ParsedEntryPlayer;
}

export interface EntryListMetadata {
  lastUpdate: string | null;
  title: string | null;
  category: string | null;
}

export interface ParseResult {
  teams: ParsedTeam[];
  metadata: EntryListMetadata;
}

const HEADER_RE = /^Pos\s+(Ranking\s+)?/i;

function isHeaderLine(line: string): boolean {
  return (
    HEADER_RE.test(line) ||
    (line.toLowerCase().includes('ranking') && line.toLowerCase().includes('player'))
  );
}

export function parseEntryListText(text: string): ParseResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const teams: ParsedTeam[] = [];
  const playerRe = /^(\d+)\s+(.+?)\s+([A-Z]{2,3})\s*$/;
  const playerNoRankRe = /^(.+?)\s+([A-Z]{2,3})\s*$/;
  const pointsRe = /(\d+)\s+points/;
  const positionRe = /^(\d+)\s+/;

  let currentDrawType: DrawType = 'main';
  let headerCount = 0;

  const metadata = extractMetadataFromText(text);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (/^QUALIF/i.test(line)) {
      currentDrawType = 'qualifying';
      i++;
      continue;
    }

    if (isHeaderLine(line)) {
      headerCount++;
      if (headerCount >= 2 && currentDrawType === 'main') {
        currentDrawType = 'qualifying';
      }
      i++;
      continue;
    }

    if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) {
      i++;
      continue;
    }
    if (/^(MAIN DRAW|ENTRY LIST|FIP\s|Last Update)/i.test(line)) {
      i++;
      continue;
    }

    const hasWC = /^(\d+)\s+WC\s+/i.test(line);
    const wcLine = hasWC ? line.replace(/^(\d+)\s+WC\s+/i, '$1 ') : line;

    const posMatch = positionRe.exec(wcLine);
    if (!posMatch) {
      i++;
      continue;
    }
    const position = parseInt(posMatch[1]!, 10);
    const afterPos = wcLine.replace(/^\d+\s*\t?\s*/, '');

    const p1Match = playerRe.exec(afterPos);
    let player1Ranking: number;
    let player1Name: string;
    let player1Country: string;
    if (p1Match) {
      player1Ranking = parseInt(p1Match[1]!, 10);
      player1Name = p1Match[2]!.trim();
      player1Country = p1Match[3]!;
    } else {
      const p1NoRank = playerNoRankRe.exec(afterPos);
      if (!p1NoRank) {
        i++;
        continue;
      }
      player1Ranking = 0;
      player1Name = p1NoRank[1]!.trim();
      player1Country = p1NoRank[2]!;
    }

    if (i + 1 >= lines.length) break;
    const line2 = lines[i + 1]!;
    const p1PointsMatch = pointsRe.exec(line2);
    if (!p1PointsMatch) {
      i++;
      continue;
    }
    const player1Points = parseInt(p1PointsMatch[1]!, 10);
    const afterPoints1 = line2.slice(p1PointsMatch.index + p1PointsMatch[0].length).trim();

    let player2Ranking = 0;
    let player2Name = '';
    let player2Country = '';
    let player2Points = 0;
    let linesConsumed = 3;

    const p2Match = playerRe.exec(afterPoints1);
    if (p2Match) {
      player2Ranking = parseInt(p2Match[1]!, 10);
      player2Name = p2Match[2]!.trim();
      player2Country = p2Match[3]!;

      if (i + 2 >= lines.length) break;
      const line3 = lines[i + 2]!;
      const p2PointsMatch = pointsRe.exec(line3);
      if (!p2PointsMatch) {
        i++;
        continue;
      }
      player2Points = parseInt(p2PointsMatch[1]!, 10);
    } else {
      if (i + 3 >= lines.length) {
        i++;
        continue;
      }
      const line3 = lines[i + 2]!;
      const p2AltMatch = /^(.+?)\s+([A-Z]{2,3})\s*$/.exec(line3);
      if (!p2AltMatch) {
        i++;
        continue;
      }
      player2Name = p2AltMatch[1]!.trim();
      player2Country = p2AltMatch[2]!;

      const line4 = lines[i + 3]!;
      const p2PointsMatch = pointsRe.exec(line4);
      if (!p2PointsMatch) {
        i++;
        continue;
      }
      player2Points = parseInt(p2PointsMatch[1]!, 10);
      linesConsumed = 4;
    }

    const teamPointsLine = lines[i + linesConsumed - 1]!;
    const teamPointsMatch = /(\d+)\s*$/.exec(teamPointsLine);
    const teamPoints = teamPointsMatch ? parseInt(teamPointsMatch[1]!, 10) : 0;

    teams.push({
      position,
      teamPoints,
      drawType: currentDrawType,
      isWildCard: hasWC,
      player1: { name: player1Name, country: player1Country, ranking: player1Ranking, points: player1Points },
      player2: { name: player2Name, country: player2Country, ranking: player2Ranking, points: player2Points },
    });
    i += linesConsumed;
  }
  return { teams, metadata };
}

function extractMetadataFromText(text: string): EntryListMetadata {
  const lastUpdateMatch = /Last Update:\s*(.+)/i.exec(text);
  const titleMatch = /^(FIP\s+\w+\s+\w+)/m.exec(text);
  const categoryMatch = /ENTRY LIST\s+(\S+)/i.exec(text);

  return {
    lastUpdate: lastUpdateMatch?.[1]?.trim() ?? null,
    title: titleMatch?.[1]?.trim() ?? null,
    category: categoryMatch?.[1]?.trim() ?? null,
  };
}
