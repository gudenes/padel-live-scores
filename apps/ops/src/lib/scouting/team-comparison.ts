import {decidingPoints} from './deciding-points';
import type {TimelinePoint} from './tracking';
import type {DeuceRule} from './scoring';
import type {teamSummary} from './insights';
export function teamComparisonRows(teams:ReturnType<typeof teamSummary>,points:TimelinePoint[],scoringRule?:DeuceRule):[string,number,number,string[]?][]{
  const run = (team:'a'|'b') => {
    let r = 0,
      max = 0;
    for (const p of points) {
      r = p.winner === team ? r + 1 : 0;
      max = Math.max(max, r);
    }
    return max;
  };
  const rows:[string,number,number,string[]?][] = [
    ["Points won", teams[0].won, teams[1].won],
    ["Winners", teams[0].winners, teams[1].winners],
    ["Unforced errors", teams[0].unforced, teams[1].unforced],
    ["Forced errors committed", teams[0].forced, teams[1].forced],
    ["Forced errors created", teams[0].created, teams[1].created],
    ["Assists", teams[0].assists, teams[1].assists],
    [
      "Smash points / attempts",
      teams[0].smashPointsWon,
      teams[1].smashPointsWon,
      teams.map((t) => t.smashPointsWon + " / " + t.smashes),
    ],
    [
      "Breaks / opportunities",
      teams[0].breaks,
      teams[1].breaks,
      teams.map((t) => t.breaks + " / " + t.breakPoints),
    ],
    ...decidingPoints(points, scoringRule).map((p):[string,number,number,string[]] => [
      `${p.label} won / opportunities`,
      p.a,
      p.b,
      [p.a, p.b].map(won => `${won} / ${p.total}`),
    ]),
    ["Double faults", teams[0].doubleFaults, teams[1].doubleFaults],
    ["Longest point run", run("a"), run("b")],
  ];
  return rows;
}
