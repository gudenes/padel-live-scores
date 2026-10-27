"use client";
import Link from "next/link";
import PreGameComparison from "./PreGameComparison";
import {playerProfileHref} from "@/lib/scouting/navigation";
import { useEffect, useState } from "react";
import type { ReportContext } from "@/lib/scouting/report-view";
import { pbpAnalysis } from "@/lib/scouting/pbp-report";
import { Clock, CaretDown } from "./Icons";
import "./report-view.css";
const last = (name: string) => name.split(" ").at(-1) ?? name;
function Unavailable({ title }: { title: string }) {
  return (
    <section className="panel unavailableWidget">
      <h2>{title}</h2>
      <span className="unavailableLabel">Not available</span>
      <p>Match not scouted. This widget needs recorded scouting data.</p>
    </section>
  );
}
export default function PbpInsightsView({
  context,
  matchId,
  onScopeChange,
}: {
  context: ReportContext;
  matchId?: string;
  onScopeChange: (scope: string) => void;
}) {
  const [scope, setScope] = useState("all"),
    [tab, setTab] = useState(matchId && context.status === "scheduled" ? "Pre-game" : "Overview"),
    [selected, setSelected] = useState<string | null>(null);
  const [navigationReady, setNavigationReady] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('pn-pbp-view:' + location.pathname) || '{}');
      if (['Pre-game','Overview','Match flow','Players','Points & shots','Data coverage'].includes(saved.tab) && (saved.tab !== 'Pre-game' || matchId)) setTab(saved.tab);
      if (saved.scope === 'all' || /^[1-5]$/.test(saved.scope)) { setScope(saved.scope); onScopeChange(saved.scope); }
      if (typeof saved.selected === 'string') setSelected(saved.selected);
    } catch { /* Browsing works without storage. */ }
    setNavigationReady(true);
  }, []);
  useEffect(() => {
    if (navigationReady) try { sessionStorage.setItem('pn-pbp-view:' + location.pathname, JSON.stringify({scope,tab,selected})); } catch { /* Optional persistence. */ }
  }, [navigationReady,scope,tab,selected]);
  const data = pbpAnalysis(context, scope),
    all = pbpAnalysis(context),
    players = context.players ?? [],
    sets = context.sets ?? [];
  const pair = (team: number) =>
    players
      .slice(team * 2, team * 2 + 2)
      .map((p) => last(p.name))
      .join(" / ") || "Pair " + (team + 1);
  const availableSets = [
    ...new Set([
      ...(context.sets ?? []).map((s, i) => s.set_number ?? i + 1),
      ...all.games.map((g) => g.set_number),
      ...all.points
        .map((p) => p.set_number)
        .filter((n): n is number => n !== undefined),
    ]),
  ].sort((a, b) => a - b);
  const max = Math.max(1, ...all.games.flatMap((g) => [g.wonA, g.wonB]));
  const metric = (label: string, a: React.ReactNode, b: React.ReactNode) => (
    <div className="compareRow" key={label}>
      <div className="compareNumbers">
        <b>{a}</b>
        <span>{label}</span>
        <b>{b}</b>
      </div>
    </div>
  );
  const percent = (won: number, played: number) =>
    played
      ? `${won} / ${played} (${Math.round((100 * won) / played)}%)`
      : "Not available";
  const momentum = (
    <section className="panel momentumPanel">
      <div className="momentumHead">
        <div>
          <h2>Match momentum</h2>
          <p className="muted">
            Recorded PBP points won per game · separated by set
          </p>
        </div>
        <span className="detailbadge">Official PBP</span>
      </div>
      {all.games.length && all.records ? (
        <div className="trajectoryScroll">
          <div className="trajectory">
            <aside className="trajectoryTeams">
              {[0, 1].map((team) => (
                <div className={"trajectoryTeam team" + team} key={team}>
                  <div className="teamAvatars">
                    {players.slice(team * 2, team * 2 + 2).map((p) => (
                      <img
                        key={p.id}
                        src={
                          context.avatars[p.id] ??
                          p.avatar_url ??
                          "/scouting/player-placeholder.svg"
                        }
                        alt={p.name}
                      />
                    ))}
                  </div>
                  <strong>{pair(team)}</strong>
                </div>
              ))}
            </aside>
            <div className="trajectorySets">
              {availableSets.map((set) => {
                const games = all.games.filter((g) => g.set_number === set),
                  score = sets.find((s, i) => (s.set_number ?? i + 1) === set);
                return (
                  <article
                    className="trajectorySet"
                    key={set}
                    style={{ flex: Math.max(1, games.length) }}
                  >
                    <div className="trajectorySetHead">
                      <h3>Set {set}</h3>
                      <strong>{score ? `${score.a}–${score.b}` : "—"}</strong>
                    </div>
                    <div className="trajectoryBars">
                      {games.map((g) => (
                        <button
                          key={g.id}
                          className={
                            "trajectoryBar " +
                            (selected === g.id ? "selected" : "")
                          }
                          aria-label={`Set ${set}, game ${g.game_number}${
                            g.is_tiebreak ? ", tie-break" : ""
                          }`}
                          onClick={() => {
                            setSelected(g.id);
                            setTab("Match flow");
                          }}
                          title={
                            g.records.length
                              ? `${g.wonA} / ${g.wonB} recorded points${
                                  g.unknown
                                    ? " · " + g.unknown + " unknown"
                                    : ""
                                }`
                              : "No recorded points in this game"
                          }
                        >
                          <span className="trajectoryHalf upper">
                            <i style={{ height: (100 * g.wonA) / max + "%" }} />
                            {g.break === true && g.winner_pair === 1 && (
                              <em
                                style={{ bottom: (100 * g.wonA) / max + "%" }}
                              >
                                Break
                              </em>
                            )}
                          </span>
                          <span className="trajectoryHalf lower">
                            <i style={{ height: (100 * g.wonB) / max + "%" }} />
                            {g.break === true && g.winner_pair === 2 && (
                              <em style={{ top: (100 * g.wonB) / max + "%" }}>
                                Break
                              </em>
                            )}
                          </span>
                          <small>{g.is_tiebreak ? "TB" : g.game_number}</small>
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <p>No PBP sequence available for this match.</p>
      )}
      <p className="muted">
        Bars use recorded points. Missing points are not estimated; the official
        result is shown separately.
      </p>
    </section>
  );
  return (
    <div className="matchInsights">
      <div className="reportBody">
        <div className="crumb">
          <span>
            Matches / {context.meta.tournament ?? "Match"} /{" "}
            <b>Match insights</b>
          </span>
          <span className="badge">
            {all.records ? "PBP available" : "Official match"} · Not scouted
          </span>
        </div>
        <section className="hero">
          <div className="heroTeam">
            {players.slice(0, 2).map((p) => (
              <div key={p.id}>
                <img
                  src={
                    context.avatars[p.id] ??
                    p.avatar_url ??
                    "/scouting/player-placeholder.svg"
                  }
                  alt=""
                />
                <b>{p.name}</b>{p.ranking != null && <small title="Current stored world ranking">World #{p.ranking}</small>}{playerProfileHref([p.existingPlayerId??p.id])&&<Link className="profileConnection" href={playerProfileHref([p.existingPlayerId??p.id])!} aria-label={`View full profile: ${p.name}`}>Full profile ↗</Link>}
              </div>
            ))}
            {playerProfileHref(players.slice(0, 2).map(p=>p.existingPlayerId??p.id))&&<Link className="pairConnection" href={playerProfileHref(players.slice(0, 2).map(p=>p.existingPlayerId??p.id))!} aria-label={`View pair: ${players.slice(0, 2).map(p=>p.name).join(" / ")}`}>View pair ↗</Link>}
          </div>
          <div className="result">
            <small>
              {[
                context.meta.tournament,
                context.meta.category,
                context.meta.round,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
            <h1 className="setScores">
              {sets.length
                ? sets.map((s, i) => {
                    const tie = all.ties[s.set_number ?? i + 1];
                    return (
                      <span key={i}>
                        {s.a}
                        {tie && s.a < s.b && <sup>{tie.a}</sup>}–{s.b}
                        {tie && s.b < s.a && <sup>{tie.b}</sup>}
                      </span>
                    );
                  })
                : tab === "Pre-game" && context.status === "scheduled" ? "Upcoming match" : "Result pending"}
            </h1>
            <span>
              <Clock size={15} /> Official match:{" "}
              {context.meta.duration ?? "Not available"}
            </span>
            <strong>
              {context.winnerPair
                ? pair(context.winnerPair - 1) + " won"
                : context.status ?? "Match available"}
            </strong>
          </div>
          <div className="heroTeam">
            {players.slice(2, 4).map((p) => (
              <div key={p.id}>
                <img
                  src={
                    context.avatars[p.id] ??
                    p.avatar_url ??
                    "/scouting/player-placeholder.svg"
                  }
                  alt=""
                />
                <b>{p.name}</b>{p.ranking != null && <small title="Current stored world ranking">World #{p.ranking}</small>}{playerProfileHref([p.existingPlayerId??p.id])&&<Link className="profileConnection" href={playerProfileHref([p.existingPlayerId??p.id])!} aria-label={`View full profile: ${p.name}`}>Full profile ↗</Link>}
              </div>
            ))}
            {playerProfileHref(players.slice(2, 4).map(p=>p.existingPlayerId??p.id))&&<Link className="pairConnection" href={playerProfileHref(players.slice(2, 4).map(p=>p.existingPlayerId??p.id))!} aria-label={`View pair: ${players.slice(2, 4).map(p=>p.name).join(" / ")}`}>View pair ↗</Link>}
          </div>
        </section>
        <div className="tabs">
          {[
            ...(matchId ? ["Pre-game"] : []),
            "Overview",
            "Match flow",
            "Players",
            "Points & shots",
            "Data coverage",
          ].map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t === "Players" ? "Player performance" : t}
            </button>
          ))}
        </div>
        {tab !== "Pre-game" && <div className="toolbar">
          <div className="seg">
            {["all", ...availableSets.map(String)].map((key) => (
              <button
                key={key}
                className={scope === key ? "active" : ""}
                onClick={() => {
                  setScope(key);
                  onScopeChange(key);
                }}
              >
                {key === "all" ? "Full match" : "Set " + key}
              </button>
            ))}
          </div>
          <span>{data.records} PBP records · No scouting</span>
        </div>}
        {data.excludedRecords>0&&<p className="coverageNotice">{data.excludedRecords} PBP record(s) fall outside the official finished set’s game count and are excluded from summary stats. Raw exports retain them.</p>}<div className="tabContent" key={tab}>
          {tab === "Pre-game" && matchId && <PreGameComparison matchId={matchId}/>}
          {tab === "Overview" && (
            <>
              {momentum}
              <div className="split overviewAnalytics">
                <section className="panel">
                  <h2>
                    Team summary ·{" "}
                    {scope === "all" ? "Full match" : "Set " + scope}
                  </h2>
                  <p className="muted">
                    Based on recorded PBP, which may be incomplete.
                  </p>
                  <div className="compare">
                    <div className="compareTeams">
                      <strong>{pair(0)}</strong>
                      <strong>{pair(1)}</strong>
                    </div>
                    {metric(
                      "Recorded points won",
                      data.records ? data.teams[0].won : "Not available",
                      data.records ? data.teams[1].won : "Not available"
                    )}
                    {metric(
                      "Service points won",
                      ...(data.teams.map((t) =>
                        percent(t.serviceWon, t.servicePlayed)
                      ) as [string, string])
                    )}
                    {metric(
                      "Return points won",
                      ...(data.teams.map((t) =>
                        percent(t.returnWon, t.returnPlayed)
                      ) as [string, string])
                    )}
                    {metric(
                      "Confirmed breaks",
                      ...(data.teams.map((t) =>
                        data.knownServerGames ? t.breaks : "Not available"
                      ) as [number | string, number | string])
                    )}
                    {metric(
                      "Confirmed holds",
                      ...(data.teams.map((t) =>
                        data.knownServerGames ? t.holds : "Not available"
                      ) as [number | string, number | string])
                    )}
                    {metric(
                      "Longest recorded run within a game",
                      ...(data.teams.map((t) =>
                        data.records ? t.longestRecordedRun : "Not available"
                      ) as [number | string, number | string])
                    )}
                  </div>
                  <p className="muted">
                    Serve metrics use only points with a known server. Unknown
                    winners: {data.unknown}.
                  </p>
                </section>
                <Unavailable title="Player impact" />
              </div>
              <div className="players">
                {players.map((p) => (
                  <section className="panel unavailableWidget" key={p.id}>
                    <div className="playerhead">
                      <img
                        src={
                          context.avatars[p.id] ??
                          p.avatar_url ??
                          "/scouting/player-placeholder.svg"
                        }
                        alt=""
                      />
                      <b>{p.name}</b>
                    </div>
                    <h3>Player Score</h3>
                    <span className="unavailableLabel">Not available</span>
                    <p>Match not scouted.</p>
                  </section>
                ))}
              </div>
            </>
          )}
          {tab === "Match flow" && (
            <>
              {momentum}
              <section className="panel">
                <h2>Official point-by-point · game breakdown</h2>
                <p className="muted">
                  Stored scores are shown as received. Gaps are not filled.
                </p>
                <div className="gameDetails">
                  {data.games.map((g) => (
                    <details
                      className="gameDetail"
                      key={g.id}
                      open={selected === g.id}
                    >
                      <summary
                        onClick={(e) => {
                          e.preventDefault();
                          setSelected(selected === g.id ? null : g.id);
                        }}
                      >
                        <span className="gameTitle">
                          Set {g.set_number} ·{" "}
                          {g.is_tiebreak
                            ? "Tie-break"
                            : "Game " + g.game_number}
                          <small>
                            {g.winner_pair
                              ? pair(g.winner_pair - 1) + " won"
                              : "Winner not recorded"}
                          </small>
                        </span>
                        <span
                          className={
                            g.break === true ? "breakBadge" : "holdBadge"
                          }
                        >
                          {g.break === true
                            ? "Break"
                            : g.break === false
                            ? "Hold"
                            : "Server unknown"}
                        </span>
                        <CaretDown size={15} />
                      </summary>
                      {g.records.length ? (
                        <div className="pbpRows">
                          <div className="pbpRow">
                            <b>Point</b>
                            {g.records.map((p, i) => (
                              <span key={p.id ?? i}>
                                {p.point_number ?? i + 1}
                              </span>
                            ))}
                          </div>
                          <div className="pbpRow">
                            <b>Recorded score</b>
                            {g.records.map((p, i) => (
                              <span key={p.id ?? i}>
                                {p.score_after ?? "—"}
                              </span>
                            ))}
                          </div>
                          <div className="pbpRow">
                            <b>Point winner</b>
                            {g.records.map((p, i) => (
                              <span
                                key={p.id ?? i}
                                className={
                                  p.winner_pair === 1
                                    ? "pointWon green"
                                    : p.winner_pair === 2
                                    ? "pointWon coral"
                                    : ""
                                }
                              >
                                {p.winner_pair === 1
                                  ? "Pair 1"
                                  : p.winner_pair === 2
                                  ? "Pair 2"
                                  : "Unknown"}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="muted" style={{ padding: 16 }}>
                          No PBP records available for this game.
                        </p>
                      )}
                    </details>
                  ))}
                </div>
              </section>
            </>
          )}
          {tab === "Players" && (
            <>
              <Unavailable title="Player Score & impact" />
              <Unavailable title="Winners, errors & assists" />
            </>
          )}
          {tab === "Points & shots" && (
            <>
              <Unavailable title="Shot direction & player involvement" />
              <Unavailable title="Stroke types & smash effectiveness" />
              <Unavailable title="Rally length" />
            </>
          )}
          {tab === "Data coverage" && (
            <section className="panel">
              <h2>Data available for this match</h2>
              <div className="bigstat">
                {all.records}
                <span>Official PBP records</span>
              </div>
              <p>
                No scouting session has been saved. Stroke types, player
                outcomes, assists, smash attempts, hitter sequences and Player
                Score are unavailable.
              </p>
              <p className="muted">
                PBP records may have gaps. No scouting or inferred stroke
                records are created by opening this report.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
