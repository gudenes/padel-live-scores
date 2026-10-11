import { it, expect } from "vitest";
import {
  contextRallies,
  directionCounts,
  reportView,
  type ViewRally,
  type ReportContext,
} from "../report-view";
import { freshDoc, type Event } from "../model";
import { savedReport } from "../saved-report";
const order = [3, 2, 0, 1];
const rallies: ViewRally[] = [
  {
    id: "a",
    start: 1,
    end: 3,
    touches: [
      { player: 0, order },
      { player: 3, order },
      { player: 1, order },
    ],
  },
  {
    id: "b",
    start: 4,
    end: 8,
    touches: [
      { player: 2, order },
      { player: 0, order },
      { player: 1, order },
    ],
  },
];
it("splits rally context by server pair, and excludes absent server metadata", () => {
  const points = [
    { id: "a", server: 0 },
    { id: "b", server: 2 },
  ] as Parameters<typeof contextRallies>[1];
  expect(contextRallies(rallies, points, 1, "serve").map((r) => r.id)).toEqual([
    "a",
  ]);
  expect(contextRallies(rallies, points, 1, "return").map((r) => r.id)).toEqual(
    ["b"]
  );
  expect(contextRallies(rallies, points, 3, "serve").map((r) => r.id)).toEqual([
    "b",
  ]);
  expect(contextRallies(rallies, [], 0, "serve")).toEqual([]);
  const full = directionCounts(rallies),
    serve = directionCounts(contextRallies(rallies, points, 1, "serve")),
    ret = directionCounts(contextRallies(rallies, points, 1, "return"));
  for (let i = 0; i < 4; i++)
    for (const key of [
      "shots",
      "crossCourt",
      "downTheLine",
      "unknown",
    ] as const)
      expect(serve.players[i][key] + ret.players[i][key]).toBe(
        full.players[i][key]
      );
  expect(full.players[0]).toMatchObject({
    shots: 2,
    downTheLine: 1,
    unknown: 1,
  });
});
it("keeps final shots, same-team transitions and changed positions unknown", () => {
  const result = directionCounts([
    {
      ...rallies[0],
      touches: [
        { player: 0, order },
        { player: 1, order },
        { player: 2, order: [2, 3, 0, 1] },
      ],
    },
  ]);
  expect(result.shots).toBe(3);
  expect(result.players.reduce((n, p) => n + p.unknown, 0)).toBe(3);
});
it("builds scoped live reports without importing scores as observations, retaining avatars by identity", () => {
  const events = [
    {
      kind: "score",
      id: "seed",
      at: "2026-10-01T00:00:00Z",
      seed: {
        sets: [{ a: 5, b: 2 }],
        game: { a: 40, b: 0 },
        phase: "playing",
        returns: 0,
        server: 0,
      },
    },
    {
      kind: "point",
      id: "p1",
      at: "2026-10-01T00:00:01Z",
      player: 0,
      outcome: "winner",
      smash: false,
    },
    {
      kind: "point",
      id: "p2",
      at: "2026-10-01T00:00:02Z",
      player: 2,
      outcome: "forced",
      forcedBy: 1,
      smash: false,
    },
  ] as Event[];
  const report = savedReport(
    {
      document: { ...freshDoc(), events },
      players: ["A", "B", "C", "D"].map((name, i) => ({ id: String(i), name })),
      revision: 1,
      updated_at: "2026-10-01T00:00:00Z",
    },
    "admin"
  );
  const context: ReportContext = {
    meta: {
      duration: null,
      round: null,
      category: null,
      tournament: "Test",
      scheduled_at: null,
    },
    avatars: { "2": "/c.png" },
    pbp: [],
  };
  const data = reportView(report, context);
  expect(data.scopes.all.points).toHaveLength(2);
  expect(data.scopes["1"].points).toHaveLength(1);
  expect(data.scopes["2"].points).toHaveLength(1);
  expect(data.players[2].avatar).toBe("/c.png");
  expect(data.players[0].avatar).toContain("placeholder");
  expect(data.scopes.all.directions.shots).toBe(0);
  expect(data.scopes["1"].teams[0].winners).toBe(1);
  expect(data.partial).toBe(true);
});
