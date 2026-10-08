// Read-only chronological validation of duration and observed-finish windows.
// Run with Node 22.18+ (native TypeScript stripping), with DATABASE_URL set.
// Does not claim to validate estimates made while the predecessor is live.
import pg from "pg";
import { writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countryToTimezone } from "../padelgod/src/lib/country-timezone.ts";
import {
  calibrationHistory,
  historicalPace,
  queuedDuration,
  computeSmartSchedule,
  localPlayDay,
  durationMinutes,
} from "../padelgod/src/lib/smart-schedule.ts";
const baselineDirectory = await mkdtemp(
  join(tmpdir(), "padel-schedule-backtest-")
);
const baselinePath = join(baselineDirectory, "baseline.ts");
await writeFile(
  baselinePath,
  execFileSync(
    "git",
    ["show", "3f74b280f:padelgod/src/lib/smart-schedule.ts"],
    { encoding: "utf8" }
  )
);
const baseline = await import(pathToFileURL(baselinePath).href);
await rm(baselineDirectory, { recursive: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let rows;
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout='90s'");
  rows = (
    await client.query(`select m.id,m.tournament_id,m.court,m.court_order,m.status,m.scheduled_at,m.started_at,m.finished_at,m.duration,m.schedule_label,m.category,m.last_updated_by,m.updated_at,
 jsonb_build_object('timezone',t.timezone,'country',t.country,'level',t.level) tournament,
 (select jsonb_agg(jsonb_build_object('set_number',s.set_number,'pair1_games',s.pair1_games,'pair2_games',s.pair2_games,'is_current',s.is_current)) from sets s where s.match_id=m.id) sets
 from matches m join tournaments t on t.id=m.tournament_id
 where m.status='finished' and m.last_updated_by='padelgod' and m.started_at is not null and m.duration is not null order by m.started_at`)
  ).rows;
  await client.query("ROLLBACK");
} finally {
  await client.end();
}
for (const r of rows) {
  for (const k of ["scheduled_at", "started_at", "finished_at", "updated_at"])
    r[k] = r[k]?.toISOString() ?? null;
  r.tournament.timezone ||= countryToTimezone(r.tournament.country);
}
const eligible = calibrationHistory(rows).filter(
  (r) => historicalPace([r]).length > 0
);
const end = (r) =>
  Date.parse(r.started_at) + durationMinutes(r.duration) * 60000;
const available = (r) => Math.max(end(r), Date.parse(r.finished_at) || end(r));
const cutoff = "2026-09-02";
const historyAt = (now) =>
  eligible
    .filter(
      (r) =>
        available(r) < now && Date.parse(r.started_at) >= now - 90 * 86400000
    )
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, 1000);
const quantile = (values, p) => {
  const a = values.slice().sort((a, b) => a - b);
  if (!a.length) return null;
  return a[Math.floor((a.length - 1) * p)];
};
const stats = (sample) => ({
  samples: sample.length,
  coveragePct:
    Math.round(
      (1000 *
        sample.filter((r) => r.actual >= r.low && r.actual <= r.high).length) /
        sample.length
    ) / 10,
  medianAbsoluteMidpointErrorMin: quantile(
    sample.map((r) => Math.abs(r.actual - (r.low + r.high) / 2)),
    0.5
  ),
  p90AbsoluteMidpointErrorMin: quantile(
    sample.map((r) => Math.abs(r.actual - (r.low + r.high) / 2)),
    0.9
  ),
  medianWindowWidthMin: quantile(
    sample.map((r) => r.high - r.low),
    0.5
  ),
});
const durationOld = [],
  durationNew = [];
for (const r of eligible.filter((r) => r.started_at.slice(0, 10) >= cutoff)) {
  const history = historyAt(Date.parse(r.started_at));
  if (history.length < 40) continue;
  const hist = history.filter((m) => baseline.historicalPace([m]).length);
  const category = hist.filter((m) => m.category === r.category);
  const values = (category.length >= 20 ? category : hist).map((m) =>
    durationMinutes(m.duration)
  );
  const old =
    values.length >= 20
      ? [quantile(values, 0.15), quantile(values, 0.85)]
      : [60, 120];
  const next = queuedDuration(history, r);
  const actual = durationMinutes(r.duration);
  durationOld.push({ actual, low: old[0], high: old[1] });
  durationNew.push({ actual, low: next[0], high: next[1] });
}
const groups = new Map();
for (const r of eligible) {
  if (!r.court || r.court_order == null || !r.tournament.timezone) continue;
  const day = localPlayDay(r.started_at, r.tournament.timezone);
  if (day !== localPlayDay(r.scheduled_at, r.tournament.timezone)) continue;
  const key = [r.tournament_id, r.court.trim().toLowerCase(), day].join("|");
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const oldFinish = [],
  newFinish = [],
  details = [];
for (const group of groups.values()) {
  group.sort((a, b) => a.court_order - b.court_order);
  for (let i = 1; i < group.length; i++) {
    const prev = group[i - 1],
      next = group[i];
    if (
      next.started_at.slice(0, 10) < cutoff ||
      next.court_order !== prev.court_order + 1 ||
      group.filter((r) => r.court_order === prev.court_order).length !== 1 ||
      group.filter((r) => r.court_order === next.court_order).length !== 1
    )
      continue;
    const now = available(prev);
    if (now >= Date.parse(next.started_at) || now - end(prev) > 5 * 60000)
      continue;
    const history = historyAt(now);
    const target = {
      ...next,
      status: "scheduled",
      started_at: null,
      duration: null,
      finished_at: null,
      sets: null,
    };
    const actual = (Date.parse(next.started_at) - now) / 60000;
    const forecasts = [
      baseline.computeSmartSchedule([prev, target], history, new Date(now)),
      computeSmartSchedule([prev, target], history, new Date(now)),
    ].map((map) => map.get(next.id));
    if (forecasts.some((f) => !f?.earliest_at || !f?.latest_at)) continue;
    const samples = forecasts.map((f) => ({
      actual,
      low: (Date.parse(f.earliest_at) - now) / 60000,
      high: (Date.parse(f.latest_at) - now) / 60000,
    }));
    oldFinish.push(samples[0]);
    newFinish.push(samples[1]);
    details.push({
      match_id: next.id,
      observed_at: new Date(now).toISOString(),
      actualStart: next.started_at,
      baseline: forecasts[0],
      calibrated: forecasts[1],
      trainingMatches: history.length,
    });
  }
}
const summary = {
  generatedAt: new Date().toISOString(),
  cutoff,
  methodology:
    "Earlier finished results available before each prediction only; last 90 days, maximum 1000 matches, conservative start-quality filters. Date holdout begins September 2. Observed-finish diagnostic uses actual detection timestamp when available, never final durations from unfinished matches. Stored schedules and court metadata can have later edits; this is an offline diagnostic, not proof of live accuracy.",
  qualifiedHistory: eligible.length,
  duration: { baseline: stats(durationOld), calibrated: stats(durationNew) },
  observedFinish: { baseline: stats(oldFinish), calibrated: stats(newFinish) },
};
const output = new URL("../output/smart-schedule-history/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL("calibration-backtest.json", output),
  JSON.stringify(summary, null, 2) + "\n"
);
await writeFile(
  new URL("calibration-backtest-matches.json", output),
  JSON.stringify(details, null, 2) + "\n"
);
console.log(JSON.stringify(summary, null, 2));
