import type { OfficialPoint, ReportContext } from "./report-view";
const cell = (value: unknown) =>
  '"' + String(value ?? "").replaceAll('"', '""') + '"';
export function parsePointScore(text: string | null) {
  if (!text) return null;
  const match = text
    .trim()
    .match(/^(\d+|A|AD|ADV|GAME)\s*[-:]\s*(\d+|A|AD|ADV|GAME)$/i);
  return match
    ? { a: match[1].toUpperCase(), b: match[2].toUpperCase() }
    : null;
}
function snapshotWinner(
  previous: ReturnType<typeof parsePointScore>,
  next: ReturnType<typeof parsePointScore>
) {
  if (!previous || !next) return null;
  const a = previous.a !== next.a,
    b = previous.b !== next.b;
  // A snapshot jump affecting both pairs cannot identify a single point winner.
  if (a === b) return null;
  if (["A", "AD", "ADV"].includes(previous.a) && next.a === "40") return 2;
  if (["A", "AD", "ADV"].includes(previous.b) && next.b === "40") return 1;
  const oldValue = a ? previous.a : previous.b,
    newValue = a ? next.a : next.b;
  const standard = ["0", "15", "30", "40", "A"];
  const increment =
    standard.indexOf(newValue) === standard.indexOf(oldValue) + 1 &&
    standard.indexOf(oldValue) >= 0;
  const numeric = Number(newValue) - Number(oldValue) === 1;
  return increment || numeric || newValue === "GAME" ? (a ? 1 : 2) : null;
}
export function officialPoints(context: ReportContext): OfficialPoint[] {
  const result: OfficialPoint[] = [];
  for (const game of context.games ?? []) {
    const stored = context.pbp.filter((p) => p.game_id === game.id);
    if (stored.length) {
      result.push(
        ...stored.map((p) => ({
          ...p,
          server_player_id:
            p.server_player_id ??
            (game.is_tiebreak ? null : game.server_player_id),
        }))
      );
      continue;
    }
    const snapshots = Array.isArray(game.points) ? game.points : [];
    let previous = parsePointScore("0:0");
    snapshots.forEach((value, i) => {
      const score = typeof value === "string" ? value : null,
        next = parsePointScore(score);
      if (next && !(next.a === "0" && next.b === "0"))
        result.push({
          id: game.id + ":snapshot:" + i,
          game_id: game.id,
          set_number: game.set_number,
          game_number: game.game_number,
          point_number: i + 1,
          score_after: score,
          winner_pair: snapshotWinner(previous, next),
          server_player_id: game.server_player_id,
        });
      previous = next;
    });
  }
  // Keep older exports that have no game metadata usable.
  for (const p of context.pbp)
    if (!(context.games ?? []).some((g) => g.id === p.game_id)) result.push(p);
  return result.sort(
    (a, b) =>
      (a.set_number ?? 0) - (b.set_number ?? 0) ||
      (a.game_number ?? 0) - (b.game_number ?? 0) ||
      (a.point_number ?? 0) - (b.point_number ?? 0)
  );
}
export function pbpAnalysis(context: ReportContext, scope = "all") {
  const all = officialPoints(context);
  const outsideGames = new Set((context.games??[]).filter(g=>{
    const set=(context.sets??[]).find((s,i)=>(s.set_number??i+1)===g.set_number);
    return context.status==='finished'&&set&&Number.isInteger(set.a)&&Number.isInteger(set.b)&&g.game_number>set.a+set.b;
  }).map(g=>g.id));
  const rawPoints=all.filter(p=>scope==='all'||p.set_number===Number(scope));
  const points=rawPoints.filter(p=>!p.game_id||!outsideGames.has(p.game_id));
  const games = (context.games ?? [])
    .filter((g) => !outsideGames.has(g.id)&&(scope === "all" || g.set_number === Number(scope)))
    .map((g) => {
      const records = points.filter((p) => p.game_id === g.id);
      const serverIndex = (context.players ?? []).findIndex(
          (p) => p.id === g.server_player_id
        ),
        serverTeam = serverIndex < 0 ? null : serverIndex < 2 ? 1 : 2;
      return {
        ...g,
        records,
        wonA: records.filter((p) => p.winner_pair === 1).length,
        wonB: records.filter((p) => p.winner_pair === 2).length,
        unknown: records.filter(
          (p) => p.winner_pair !== 1 && p.winner_pair !== 2
        ).length,
        serverTeam,
        break:
          g.winner_pair && serverTeam && !g.is_tiebreak
            ? g.winner_pair !== serverTeam
            : null,
      };
    });
  const teams = [1, 2].map((team) => {
    const knownServe = points
      .map((p) => {
        const server = (context.players ?? []).findIndex(
          (x) => x.id === p.server_player_id
        );
        return { ...p, serverTeam: server < 0 ? null : server < 2 ? 1 : 2 };
      })
      .filter(
        (p) =>
          p.serverTeam !== null && (p.winner_pair === 1 || p.winner_pair === 2)
      );
    const serving = knownServe.filter((p) => p.serverTeam === team),
      returning = knownServe.filter((p) => p.serverTeam !== team);
    let best = 0,
      run = 0;
    let previous: OfficialPoint | undefined;
    for (const p of points) {
      if (
        previous &&
        (p.game_id !== previous.game_id ||
          p.point_number !== (previous.point_number ?? 0) + 1)
      )
        run = 0;
      run = p.winner_pair === team ? run + 1 : 0;
      best = Math.max(best, run);
      previous = p;
    }
    return {
      team,
      won: points.filter((p) => p.winner_pair === team).length,
      servicePlayed: serving.length,
      serviceWon: serving.filter((p) => p.winner_pair === team).length,
      returnPlayed: returning.length,
      returnWon: returning.filter((p) => p.winner_pair === team).length,
      longestRecordedRun: best,
      breaks: games.filter((g) => g.break === true && g.winner_pair === team)
        .length,
      holds: games.filter((g) => g.break === false && g.winner_pair === team)
        .length,
    };
  });
  const ties: Record<number, { a: number; b: number }> = {};
  for (const g of games.filter((g) => g.is_tiebreak && g.winner_pair)) {
    const final = parsePointScore(
      g.records.at(-1)?.score_after ?? g.game_score ?? null
    );
    if (!final) continue;
    const a = Number(final.a),
      b = Number(final.b);
    if (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.max(a, b) >= 7 &&
      Math.abs(a - b) >= 2 &&
      (a > b ? 1 : 2) === g.winner_pair
    )
      ties[g.set_number] = { a, b };
  }
  return {
    points,
    games,
    teams,
    ties,
    records: points.length,
    excludedRecords:rawPoints.length-points.length,
    unknown: points.filter((p) => p.winner_pair !== 1 && p.winner_pair !== 2)
      .length,
    knownServerPoints: teams[0].servicePlayed + teams[1].servicePlayed,
    knownServerGames: games.filter(
      (g) => g.serverTeam !== null && !g.is_tiebreak && g.winner_pair
    ).length,
  };
}
export function pbpCsv(context: ReportContext, scope = "all") {
  const rows = [
    [
      "Source",
      "Set",
      "Game",
      "Point",
      "Pair winner",
      "Score after",
      "Server player",
      "Break point",
      "Set point",
      "Match point",
    ],
    ...officialPoints(context).filter(p=>scope==='all'||p.set_number===Number(scope)).map((p) => [
      "Official PBP",
      p.set_number,
      p.game_number,
      p.point_number,
      p.winner_pair,
      p.score_after,
      p.server_player_id,
      p.is_break_point,
      p.is_set_point,
      p.is_match_point,
    ]),
  ];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
