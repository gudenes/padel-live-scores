import React, { useState } from "react";
import { CaretDown } from "./Icons";
export function groupGames(points) {
  const games = [];
  for (const p of points) {
    const set = p.before.sets.length;
    const s = p.before.sets.at(-1);
    const key = set + ":" + s.a + ":" + s.b;
    let g = games.at(-1);
    if (!g || g.key !== key) {
      g = {
        key,
        set,
        start: s,
        points: [],
        server: p.server,
        tiebreak: p.before.phase === "tiebreak",
      };
      games.push(g);
    }
    g.points.push(p);
  }
  return games.map((g) => {
    const last = g.points.at(-1),
      after = last.after.sets[g.set - 1];
    const finished = after.a !== g.start.a || after.b !== g.start.b;
    const wonA = g.points.filter((p) => p.winner === "a").length,
      wonB = g.points.length - wonA;
    return {
      ...g,
      after,
      finished,
      winner: finished ? last.winner : null,
      break: finished && !g.tiebreak && last.breakConverted,
      wonA,
      wonB,
      margin: wonA - wonB,
    };
  });
}
export function tieBreaks(points) {
  const result = {};
  for (const p of points) {
    if (p.before.phase !== "tiebreak") continue;
    const set = p.before.sets.length;
    if (p.after.phase !== "tiebreak" || p.after.sets.length !== set) {
      const a = p.before.currentGame.a + (p.winner === "a" ? 1 : 0),
        b = p.before.currentGame.b + (p.winner === "b" ? 1 : 0);
      result[set] = { a, b };
    }
  }
  return result;
}
export function TeamComparison({ teams, pairs, points }) {
  const run = (team) => {
    let r = 0,
      max = 0;
    for (const p of points) {
      r = p.winner === team ? r + 1 : 0;
      max = Math.max(max, r);
    }
    return max;
  };
  const rows = [
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
    ["Double faults", teams[0].doubleFaults, teams[1].doubleFaults],
    ["Longest point run", run("a"), run("b")],
  ];
  return (
    <div className="compare">
      <div className="compareTeams">
        <strong>{pairs[0]}</strong>
        <strong>{pairs[1]}</strong>
      </div>
      {rows.map(([label, a, b, display]) => (
        <div className="compareRow" key={label}>
          <div className="compareNumbers">
            <b>{display ? display[0] : a}</b>
            <span>{label}</span>
            <b>{display ? display[1] : b}</b>
          </div>
          <div className="compareTracks">
            <div>
              <span
                className="compareFill green"
                style={{ width: (a + b ? (100 * a) / (a + b) : 0) + "%" }}
              />
            </div>
            <div>
              <span
                className="compareFill coral"
                style={{ width: (a + b ? (100 * b) / (a + b) : 0) + "%" }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
function pointScore(p, g) {
  if (p.id === g.points.at(-1).id && g.finished) {
    if (g.tiebreak)
      return {
        a: p.before.currentGame.a + (p.winner === "a" ? 1 : 0),
        b: p.before.currentGame.b + (p.winner === "b" ? 1 : 0),
      };
    return {
      a: p.winner === "a" ? "Game" : p.before.currentGame.a,
      b: p.winner === "b" ? "Game" : p.before.currentGame.b,
    };
  }
  return p.after.currentGame;
}
export function GameFlow({
  points,
  players,
  pairs,
  compact = false,
  initialKey = null,
  onSelect,
}) {
  const games = groupGames(points);
  const [active, setActive] = useState(() => initialKey ?? games[0]?.key);
  const selected = games.find((g) => g.key === active);
  const sets = [...new Set(games.map((g) => g.set))];
  const tb = tieBreaks(points);
  const maxPoints = Math.max(1, ...games.flatMap((g) => [g.wonA, g.wonB]));
  if (!games.length)
    return (
      <section className="panel">
        <h2>Match momentum</h2>
        <p>No recorded points are available yet.</p>
      </section>
    );
  return (
    <>
      <section className="panel momentumPanel">
        <div className="momentumHead">
          <div>
            <h2>Match momentum</h2>
            <p className="muted">
              Points won per game · same scale for both teams
            </p>
          </div>
          <span className="muted">Break = game won against serve</span>
        </div>
        <div className="trajectoryScroll">
          <div className="trajectory">
            <aside className="trajectoryTeams">
              {[0, 1].map((team) => (
                <div className={"trajectoryTeam team" + team} key={team}>
                  <div className="teamAvatars">
                    {players.slice(team * 2, team * 2 + 2).map((p) => (
                      <img src={p.avatar} alt={p.name} key={p.id} />
                    ))}
                  </div>
                  <strong>{pairs[team]}</strong>
                </div>
              ))}
            </aside>
            <div className="trajectorySets">
              {sets.map((set) => {
                const items = games.filter((g) => g.set === set);
                const last = items.at(-1);
                return (
                  <article
                    className="trajectorySet"
                    key={set}
                    style={{ flex: items.length }}
                  >
                    <div className="trajectorySetHead">
                      <h3>Set {set}</h3>
                      <strong>
                        {last.after.a}
                        {tb[set] && last.after.a < last.after.b && (
                          <sup>{tb[set].a}</sup>
                        )}
                        –{last.after.b}
                        {tb[set] && last.after.b < last.after.a && (
                          <sup>{tb[set].b}</sup>
                        )}
                      </strong>
                    </div>
                    <div className="trajectoryBars">
                      {items.map((g, i) => (
                        <button
                          className={
                            "trajectoryBar " +
                            (selected?.key === g.key ? "selected" : "")
                          }
                          key={g.key}
                          onClick={() => {
                            setActive(g.key);
                          }}
                          title={`${pairs[0]}: ${g.wonA} points · ${pairs[1]}: ${g.wonB} points`}
                          aria-label={`Set ${set}, ${
                            g.tiebreak ? "tie-break" : "game " + (i + 1)
                          }, ${g.after.a}-${g.after.b}${
                            g.break ? ", break" : ""
                          }`}
                        >
                          <span className="trajectoryHalf upper">
                            <i
                              style={{
                                height: (100 * g.wonA) / maxPoints + "%",
                              }}
                            />
                            {g.break && g.winner === "a" && (
                              <em
                                style={{
                                  bottom: (100 * g.wonA) / maxPoints + "%",
                                }}
                              >
                                Break
                              </em>
                            )}
                          </span>
                          <span className="trajectoryHalf lower">
                            <i
                              style={{
                                height: (100 * g.wonB) / maxPoints + "%",
                              }}
                            />
                            {g.break && g.winner === "b" && (
                              <em
                                style={{
                                  top: (100 * g.wonB) / maxPoints + "%",
                                }}
                              >
                                Break
                              </em>
                            )}
                          </span>
                          <small>{g.tiebreak ? "TB" : i + 1}</small>
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
        {selected && (
          <div className="trajectorySelection">
            <strong>
              Set {selected.set} ·{" "}
              {selected.tiebreak
                ? "Tie-break"
                : "Game " +
                  (games
                    .filter((g) => g.set === selected.set)
                    .findIndex((g) => g.key === selected.key) +
                    1)}
            </strong>
            <span className={selected.break ? "breakBadge" : "holdBadge"}>
              {selected.tiebreak
                ? "Tie-break"
                : selected.break
                ? "Break"
                : selected.finished
                ? "Hold"
                : "In progress"}
            </span>
            <b>
              {selected.after.a}–{selected.after.b}
              {selected.tiebreak && tb[selected.set] && (
                <sup>{Math.min(tb[selected.set].a, tb[selected.set].b)}</sup>
              )}
            </b>
            <button
              onClick={() => {
                if (compact) onSelect?.(selected.key);
                else
                  document
                    .getElementById("breakdown-" + selected.key)
                    ?.scrollIntoView({
                      behavior: window.matchMedia(
                        "(prefers-reduced-motion: reduce)"
                      ).matches
                        ? "instant"
                        : "smooth",
                      block: "center",
                    });
              }}
            >
              View points →
            </button>
          </div>
        )}
      </section>
      {!compact && (
        <section className="panel">
          <h2>Point-by-point · game breakdown</h2>
          <p className="muted">
            Scouting score replay. Official PBP is available separately in Data
            coverage.
          </p>
          <div className="gameDetails">
            {games.map((g) => (
              <details
                className="gameDetail"
                id={"breakdown-" + g.key}
                key={g.key}
                open={g.key === selected?.key}
              >
                <summary
                  onClick={(e) => {
                    e.preventDefault();
                    setActive(active === g.key ? null : g.key);
                  }}
                >
                  <span className="gameTitle">
                    Set {g.set} ·{" "}
                    {g.tiebreak
                      ? "Tie-break"
                      : "Game " +
                        (games
                          .filter((x) => x.set === g.set)
                          .findIndex((x) => x.key === g.key) +
                          1)}
                    <small>
                      Server:{" "}
                      {g.tiebreak
                        ? "rotating"
                        : players[g.server]?.name ?? "Unknown"}
                    </small>
                  </span>
                  <span className="gameResult">
                    {g.after.a}
                    {g.tiebreak && tb[g.set] && g.after.a < g.after.b && (
                      <sup>{tb[g.set].a}</sup>
                    )}
                    –{g.after.b}
                    {g.tiebreak && tb[g.set] && g.after.b < g.after.a && (
                      <sup>{tb[g.set].b}</sup>
                    )}
                  </span>
                  {g.break ? (
                    <span className="breakBadge">Break</span>
                  ) : (
                    <span className="holdBadge">
                      {g.tiebreak
                        ? "Tie-break"
                        : g.finished
                        ? "Hold"
                        : "In progress"}
                    </span>
                  )}
                  <CaretDown size={15} />
                </summary>
                <div className="pbpRows">
                  <div className="pbpRow">
                    <b>{pairs[0]}</b>
                    {g.points.map((p) => (
                      <span
                        key={p.id}
                        className={p.winner === "a" ? "pointWon green" : ""}
                      >
                        {pointScore(p, g).a}
                      </span>
                    ))}
                  </div>
                  <div className="pbpRow">
                    <b>{pairs[1]}</b>
                    {g.points.map((p) => (
                      <span
                        key={p.id}
                        className={p.winner === "b" ? "pointWon coral" : ""}
                      >
                        {pointScore(p, g).b}
                      </span>
                    ))}
                  </div>
                  <div className="pbpRow events">
                    <b>Point # / pressure</b>
                    {g.points.map((p) => (
                      <span
                        key={p.id}
                        title={
                          p.matchPoint.a || p.matchPoint.b
                            ? "Match point"
                            : p.setPoint.a || p.setPoint.b
                            ? "Set point"
                            : p.breakPoint
                            ? "Break point"
                            : "Regular point"
                        }
                      >
                        {p.number}
                        <small>
                          {p.matchPoint.a || p.matchPoint.b
                            ? "MP"
                            : p.setPoint.a || p.setPoint.b
                            ? "SP"
                            : p.breakPoint
                            ? "BP"
                            : p.star
                            ? "★"
                            : ""}
                        </small>
                      </span>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
