"use client";
import {sharedReportEvent} from "@/lib/posthog/shared-report";
import React, { useState, useEffect, useRef } from "react";
import {
  Clock,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Info,
} from "./Icons";
import "./report-view.css";
import VideoReview from "./VideoReview";
import OverviewMomentum from "./OverviewMomentum";
import ShotDistribution from "./ShotDistribution";
import { DirectionCourt } from "./DirectionCourt.jsx";
import { GameFlow, TeamComparison, tieBreaks } from "./MatchFlow.jsx";
const colors = ["#a3cf0a", "#a3cf0a", "#ed7669", "#ed7669"];
const name = (p) => p.name.split(" ").slice(-1)[0];
const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
function Chart({ series, labels, mode = "momentum", names = [], points = [] }) {
  const ref = useRef();
  const [hover, setHover] = useState(null);
  const isImpact = mode === "impact";
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const draw = () => {
      const ctx = el.getContext("2d");
      if (!ctx || !labels.length) return;
      const w = el.clientWidth,
        h = isImpact ? 360 : 230;
      el.width = w * 2;
      el.height = h * 2;
      ctx.scale(2, 2);
      const left = 38,
        right = w - (isImpact ? 62 : 24),
        top = 22,
        bottom = h - 38;
      const nums = series.flat();
      const min = isImpact ? Math.min(0, ...nums) : -10,
        max = isImpact ? Math.max(1, ...nums) : 10;
      const xFor = (i) =>
          left + ((right - left) * i) / Math.max(1, labels.length - 1),
        yFor = (n) => bottom - ((n - min) / (max - min)) * (bottom - top);
      ctx.font = "11px Arial";
      ctx.fillStyle = "#879086";
      for (let j = 0; j < 5; j++) {
        const y = top + ((bottom - top) * j) / 4;
        ctx.strokeStyle = "#dce3d8";
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillText((max - ((max - min) * j) / 4).toFixed(0), 2, y + 4);
      }
      if (isImpact) {
        points.forEach((p, i) => {
          if (
            i === points.length - 1 ||
            p.before.sets.length === points[i + 1].before.sets.length
          )
            return;
          const index = labels.indexOf(p.number);
          if (index < 0) return;
          const x = xFor(index);
          ctx.strokeStyle = "#a8b1a4";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "#74806f";
          ctx.font = "10px Arial";
          ctx.textAlign = "center";
          ctx.fillText("End set " + p.before.sets.length, x, 12);
          ctx.textAlign = "left";
        });
      }
      series.forEach((line, k) => {
        ctx.strokeStyle = isImpact ? colors[k] : "#95ba13";
        ctx.lineWidth = 2.3;
        ctx.setLineDash(isImpact && k % 2 ? [3, 5] : []);
        ctx.beginPath();
        line.forEach((n, i) => {
          const x = xFor(i),
            y = yFor(n);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      });
      ctx.setLineDash([]);
      if (isImpact) {
        const ends = series
          .map((line, k) => ({
            k,
            value: line.at(-1),
            y: yFor(line.at(-1) ?? 0),
          }))
          .filter((e) => Number.isFinite(e.value))
          .sort((a, b) => a.y - b.y);
        ends.forEach((e, i) => {
          e.labelY = Math.max(
            top + 4,
            e.y,
            i ? ends[i - 1].labelY + 17 : top + 4
          );
        });
        if (ends.length && ends.at(-1).labelY > bottom) {
          const shift = ends.at(-1).labelY - bottom;
          ends.forEach((e) => (e.labelY -= shift));
        }
        ends.forEach((e) => {
          ctx.strokeStyle = colors[e.k];
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(right, e.y);
          ctx.lineTo(right + 7, e.labelY);
          ctx.stroke();
          ctx.fillStyle = colors[e.k];
          ctx.font = "bold 11px Arial";
          ctx.fillText(
            (e.value >= 0 ? "+" : "") + e.value.toFixed(2),
            right + 10,
            e.labelY + 4
          );
        });
        if (hover !== null && labels.length) {
          const x = xFor(hover);
          ctx.strokeStyle = "#97a28e";
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          series.forEach((line, k) => {
            if (!Number.isFinite(line[hover])) return;
            ctx.fillStyle = colors[k];
            ctx.beginPath();
            ctx.arc(x, yFor(line[hover]), 4, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }
      ctx.font = "11px Arial";
      ctx.fillStyle = "#879086";
      ctx.fillText("Point " + labels[0], left, h - 10);
      ctx.fillText("Point " + labels.at(-1), right - 48, h - 10);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [series, labels, mode, hover, points, isImpact]);
  if (!labels.length)
    return <p className="muted">No observed points in this selection.</p>;
  const selectAt = (e) => {
    if (!isImpact || !labels.length) return;
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    setHover(
      Math.max(
        0,
        Math.min(
          labels.length - 1,
          Math.round(((x - 38) / (r.width - 100)) * (labels.length - 1))
        )
      )
    );
  };
  const inspected = points.find((p) => p.number === labels[hover]);
  const score = inspected?.after;
  const scoreTies = inspected
    ? tieBreaks(points.filter((p) => p.number <= inspected.number))
    : {};
  const setEnded =
    inspected && inspected.before.sets.length !== score.sets.length;
  return (
    <div className="chartWrap">
      <canvas
        className={isImpact ? "impactCanvas" : ""}
        ref={ref}
        onPointerMove={selectAt}
        onPointerLeave={() => setHover(null)}
        onPointerDown={selectAt}
        tabIndex={isImpact ? 0 : undefined}
        onFocus={() => isImpact && setHover(labels.length - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (isImpact && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            setHover(
              Math.max(
                0,
                Math.min(
                  labels.length - 1,
                  (hover ?? labels.length - 1) +
                    (e.key === "ArrowRight" ? 1 : -1)
                )
              )
            );
          }
        }}
        aria-label={
          isImpact
            ? "Cumulative player impact. Use left and right arrows to inspect each point."
            : "Rolling ten-point team balance"
        }
        role="img"
      />
      {isImpact && hover !== null && (
        <div className="impactTooltip" role="status">
          <strong>Point {labels[hover]} · impact</strong>
          {score && (
            <div className="tooltipScore">
              <span>Score after point</span>
              <b>
                {score.sets.map((s, i) => (
                  <React.Fragment key={i}>
                    {i > 0 ? " · " : ""}
                    {s.a}
                    {scoreTies[i + 1] && s.a < s.b && (
                      <sup>{scoreTies[i + 1].a}</sup>
                    )}
                    –{s.b}
                    {scoreTies[i + 1] && s.b < s.a && (
                      <sup>{scoreTies[i + 1].b}</sup>
                    )}
                  </React.Fragment>
                ))}
              </b>
              <small>
                {score.phase === "finished"
                  ? "Match finished"
                  : setEnded
                  ? "Set " + inspected.before.sets.length + " finished"
                  : (score.phase === "tiebreak" ? "Tie-break " : "Game ") +
                    score.currentGame.a +
                    "–" +
                    score.currentGame.b}
              </small>
            </div>
          )}
          {series.map((line, k) => (
            <div key={k}>
              <span style={{ color: colors[k] }}>
                {names[k] ?? "Player " + (k + 1)}
              </span>
              <b>
                {line[hover] >= 0 ? "+" : ""}
                {line[hover]?.toFixed(2) ?? "—"}
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function Panel({ title, sub, children, className = "" }) {
  return (
    <section className={"panel " + className}>
      <h2>{title}</h2>
      {sub && <p className="muted">{sub}</p>}
      {children}
    </section>
  );
}
export function MatchInsightsView({ data, onScopeChange, reports, shared = false }) {
  const headerSentinel=useRef(null);
  const heroRef=useRef(null),expandedHeight=useRef(0);
  const [headerSpace,setHeaderSpace]=useState(0);
  const [compactHeader,setCompactHeader]=useState(false);
  const [headerOffset,setHeaderOffset]=useState(shared?0:76);
  useEffect(()=>{
    const nav=document.querySelector('.gheader');
    const measure=()=>setHeaderOffset(document.querySelector('main.main')?0:(nav?.getBoundingClientRect().height??(shared?0:76)));
    measure();const resize=new ResizeObserver(measure);if(nav)resize.observe(nav);
    return()=>resize.disconnect();
  },[]);
  useEffect(()=>{
    const observer=new IntersectionObserver(([entry])=>setCompactHeader(!entry.isIntersecting&&entry.boundingClientRect.top<(entry.rootBounds?.top??headerOffset)),{root:document.querySelector('main.main'),rootMargin:`-${headerOffset}px 0px 0px 0px`});
    if(headerSentinel.current)observer.observe(headerSentinel.current);
    return()=>observer.disconnect();
  },[headerOffset]);
  useEffect(()=>{
    const el=heroRef.current;if(!el)return;
    const measure=()=>{const height=el.getBoundingClientRect().height;if(!compactHeader){expandedHeight.current=height;setHeaderSpace(0)}else setHeaderSpace(Math.max(0,expandedHeight.current-height));};
    measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();
  },[compactHeader]);
  const [scope, setScope] = useState("all"),
    [tab, setTab] = useState("Overview"),
    [gameSelection, setGameSelection] = useState(null),
    [kind, setKind] = useState("all"),
    [player, setPlayer] = useState("all"),
    [current, setCurrent] = useState(0),
    [source, setSource] = useState("scout");
  const d = data.scopes[scope],
    points = d.points,
    teams = d.teams;
  const pair = (t) =>
    data.players
      .slice(t * 2, t * 2 + 2)
      .map(name)
      .join(" / ");
  const filter = points.filter(
    (p) =>
      (kind === "all" || p.outcome === kind) &&
      (player === "all" || p.player === Number(player))
  );
  const chosen = filter[Math.min(current, filter.length - 1)];
  const impact = d.analysis.series.length
    ? [0, 1, 2, 3].map((k) => d.analysis.series.map((p) => p.values[k]))
    : [[], [], [], []];
  const tieScores = tieBreaks(data.scopes.all.points);
  const playerCards = (
    <div className="players" title="Key points: break points, star points, tiebreaks, set points and match points. The score uses only those observed points; overlapping situations count once.">
      {data.players.map((p, i) => (
        <article className="player" key={p.id}>
          <div className="playerhead">
            <img src={p.avatar} alt={p.name} />
            <b>{p.name}</b>
            <strong className={i < 2 ? "rating" : "rating coral"}>
              {d.analysis.players[i].score?.toFixed(1) ?? "—"}
              <small>/10</small>
            </strong>
          </div>
          {[
            ["Winners", d.stats[i].winners],
            ["Unforced errors", d.stats[i].unforced],
            ["Forced errors committed", d.stats[i].forced],
            ["Forced errors created", d.stats[i].forcedErrorsCreated],
            ["Assists", d.stats[i].assists],
            [
              "Smash points / attempts",
              d.stats[i].smashPointsWon + " / " + d.stats[i].smashes,
            ],
            ["Weighted impact", d.analysis.players[i].impact.toFixed(2)],
            ["Key-point score / 10", d.keyPointAnalysis?.players[i].score?.toFixed(1) ?? "—"],
            ["Key-point impact", d.keyPointAnalysis?.observedPoints ? d.keyPointAnalysis.players[i].impact.toFixed(2) : "—"],
          ].map(([l, v]) => (
            <div className="stat" key={l}>
              <span>{l}</span>
              <b>{v}</b>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
  return (
    <div className="matchInsights">
      <div className="reportBody">
        <div className="crumb">
          <span>
            Matches / {data.meta.tournament ?? "Private match"} /{" "}
            <b>Match insights</b>
          </span>
          <span className="badge">
            <CheckCircle size={14} />{" "}
            {data.finished ? "Scouted" : "Scouting in progress"}
          </span>
        </div>
        <div ref={headerSentinel} className="match-header-sentinel" aria-hidden="true"/><section ref={heroRef} className={`hero match-sticky-hero${compactHeader?' is-compact':''}`} style={{'--match-header-offset':`${headerOffset}px`}}>
          <div className="heroTeam">
            {data.players.slice(0, 2).map((p) => (
              <div key={p.id}>
                <img src={p.avatar} alt="" />
                <b>{p.name}</b>
              </div>
            ))}
          </div>
          <div className="result">
            <small>
              {[data.meta.tournament, data.meta.category, data.meta.round]
                .filter(Boolean)
                .join(" · ") || "Private scouting"}
            </small>
            <h1 className="setScores">
              {data.sets.map((s, i) => (
                <span key={i}>
                  {s.a}
                  {tieScores[i + 1] && s.a < s.b && (
                    <sup>{tieScores[i + 1].a}</sup>
                  )}
                  –{s.b}
                  {tieScores[i + 1] && s.b < s.a && (
                    <sup>{tieScores[i + 1].b}</sup>
                  )}
                </span>
              ))}
            </h1>
            <span>
              <Clock size={15} /> Official match:{" "}
              {data.meta.duration ?? "Not available"}
            </span>
            <strong>
              {data.winner
                ? pair(data.winner === "a" ? 0 : 1) + " won"
                : "Scouting in progress"}
            </strong>
          </div>
          <div className="heroTeam">
            {data.players.slice(2).map((p) => (
              <div key={p.id}>
                <img src={p.avatar} alt="" />
                <b>{p.name}</b>
              </div>
            ))}
          </div>
        <div className="toolbar match-header-scope">
          <div className="seg" role="group" aria-label="Filter match report by set">
            {Object.keys(data.scopes)
              .sort((a, b) => (a === "all" ? -1 : b === "all" ? 1 : 0))
              .map((k) => (
                <button
                  className={`ui-btn ${scope === k ? "active" : ""}`}
                  aria-pressed={scope === k}
                  onClick={() => {
                    setScope(k);
                    if(shared)sharedReportEvent("shared_report_set_selected",{scope:k});
                    onScopeChange?.(k);
                    setCurrent(0);
                  }}
                  key={k}
                >
                  {k === "all" ? "Full match" : "Set " + k}
                </button>
              ))}
          </div>
          <span>{points.length} observed points</span>

        </div>
        </section>
        <div aria-hidden="true" style={{height:headerSpace,flexShrink:0}}/>
        <div className="tabs">
          {[
            "Overview",
            "Match flow",
            "Players",
            "Points & shots",
            "Video review",
            "Data coverage",
            "Reports",
          ].filter(t=>!shared||(t!=="Reports"&&(t!=="Video review"||!!data.videoUrl))).map((t) => (
            <button
              className={t === tab ? "active" : ""}
              onClick={() => {
                setTab(t);
                if(shared)sharedReportEvent("shared_report_tab_selected",{tab:t});
                setCurrent(0);
              }}
              key={t}
            >
              {t}
            </button>
          ))}
        </div>
        {data.contextUnavailable && (
          <p className="coverageNotice">
            Official metadata is temporarily unavailable. Saved scouting is
            shown below.
          </p>
        )}
        <div className="tabContent" key={tab}>
          {tab === "Overview" && (
            <>
              <OverviewMomentum data={data} scope={scope} />
              <div className="split overviewAnalytics">
                <Panel
                  title={
                    "Team summary · " +
                    (scope === "all" ? "Full match" : "Set " + scope)
                  }
                >
                  <TeamComparison
                    players={data.players}
                    teams={teams}
                    pairs={[pair(0), pair(1)]}
                    points={points}
                  />
                  <small>
                    Smash effectiveness = winners + explicitly attributed errors
                    generated.
                  </small>
                </Panel>
                <Panel
                  className="impactPanel"
                  title="Player impact"
                  sub="Cumulative contribution · solid and dotted lines distinguish teammates"
                >
                  <Chart
                    mode="impact"
                    names={data.players.map((p) => p.name)}
                    points={points}
                    series={impact}
                    labels={d.analysis.series.map((p) => p.number)}
                  />
                  <div className="impactLegend">
                    {data.players.map((p, i) => (
                      <div
                        className={i < 2 ? "teamLime" : "teamCoral"}
                        key={p.id}
                      >
                        <img src={p.avatar} alt="" />
                        <span
                          className={i % 2 ? "lineSample dotted" : "lineSample"}
                        />
                        <span>{p.name}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
              <Panel title="Player performance" sub={`${d.keyPointAnalysis?.observedPoints ?? 0} key points observed · Break, star, tiebreak, set and match points.`}>{playerCards}</Panel>
            </>
          )}
          {tab === "Match flow" && (
            <>
              <GameFlow
                initialKey={gameSelection}
                points={data.scopes.all.points}
                players={data.players}
                pairs={[pair(0), pair(1)]}
              />
              <Panel title="Pressure points">
                <table>
                  <thead>
                    <tr>
                      <th>Point</th>
                      <th>Set</th>
                      <th>Situation</th>
                      <th>Point winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points
                      .filter(
                        (p) =>
                          p.breakPoint ||
                          p.setPoint.a ||
                          p.setPoint.b ||
                          p.matchPoint.a ||
                          p.matchPoint.b ||
                          p.star
                      )
                      .map((p) => (
                        <tr key={p.id}>
                          <td>#{p.number}</td>
                          <td>{p.before.sets.length}</td>
                          <td>
                            {p.matchPoint.a || p.matchPoint.b
                              ? "Match point"
                              : p.setPoint.a || p.setPoint.b
                              ? "Set point"
                              : p.breakPoint
                              ? "Break point"
                              : "Star point"}
                          </td>
                          <td>{pair(p.winner === "a" ? 0 : 1)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </Panel>
            </>
          )}
          {tab === "Players" && (
            <>
              <ShotDistribution data={data} scope={scope} />
              <Panel
                title="Player performance"
                sub={`${d.keyPointAnalysis?.observedPoints ?? 0} key points observed · Break, star, tiebreak, set and match points. Ratings follow the selected set.`}
              >
                {playerCards}
              </Panel>
              <Panel title="Impact evolution">
                <Chart
                  mode="impact"
                  names={data.players.map((p) => p.name)}
                  points={points}
                  series={impact}
                  labels={d.analysis.series.map((p) => p.number)}
                />
                <div className="impactLegend">
                  {data.players.map((p, i) => (
                    <div
                      className={i < 2 ? "teamLime" : "teamCoral"}
                      key={p.id}
                    >
                      <img src={p.avatar} alt="" />
                      <span
                        className={i % 2 ? "lineSample dotted" : "lineSample"}
                      />
                      <span>{p.name}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}
          {tab === "Video review" && <VideoReview data={data} scope={scope} readOnly={shared} />}
          {tab === "Points & shots" && (
            <>
              <DirectionCourt
                players={data.players}
                directions={d.directions}
                rallies={d.taps}
                points={d.points}
              />
              <div className="filters">
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setCurrent(0);
                  }}
                  aria-label="Outcome"
                >
                  <option value="all">All outcomes</option>
                  <option value="winner">Winner</option>
                  <option value="unforced">Unforced error</option>
                  <option value="forced">Forced error</option>
                  <option value="double_fault">Double fault</option>
                </select>
                <select
                  value={player}
                  onChange={(e) => {
                    setPlayer(e.target.value);
                    setCurrent(0);
                  }}
                  aria-label="Player"
                >
                  <option value="all">All players</option>
                  {data.players.map((p, i) => (
                    <option value={i} key={i}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span>{filter.length} points found</span>
              </div>
              <div className="split">
                <Panel
                  title="Point detail"
                  sub="Stored strokes and attribution; no invented landing zones."
                >
                  {chosen ? (
                    <>
                      <div className="pointnav">
                        <button
                          aria-label="Previous point"
                          disabled={current === 0}
                          onClick={() => setCurrent(current - 1)}
                        >
                          <ArrowLeft />
                        </button>
                        <h3>
                          Point #{chosen.number} · Set{" "}
                          {chosen.before.sets.length}
                        </h3>
                        <button
                          aria-label="Next point"
                          disabled={current >= filter.length - 1}
                          onClick={() => setCurrent(current + 1)}
                        >
                          <ArrowRight />
                        </button>
                      </div>
                      <h2>
                        {chosen.player === null
                          ? "Unclassified"
                          : data.players[chosen.player].name}
                      </h2>
                      <div className="detailbadge">
                        {chosen.outcome.replace("_", " ")} ·{" "}
                        {chosen.shot ?? "Stroke not recorded"}
                      </div>
                      {[
                        [
                          "Previous player",
                          chosen.previousPlayer === undefined
                            ? "Not recorded"
                            : data.players[chosen.previousPlayer]?.name ??
                              "Not recorded",
                        ],
                        [
                          "Previous stroke",
                          chosen.previousShot ?? "Not recorded",
                        ],
                        [
                          "Assist",
                          chosen.assistBy === undefined
                            ? "Not recorded"
                            : data.players[chosen.assistBy]?.name ??
                              "Not recorded",
                        ],
                        [
                          "Video position",
                          data.source === "video" &&
                          new Date(chosen.at).getTime() / 1000 < 604800
                            ? new Date(chosen.at).toISOString().slice(11, 19)
                            : "Live timestamp · seek not verified",
                        ],
                        [
                          "Rally duration",
                          chosen.durationMs === null
                            ? "Not timed"
                            : (chosen.durationMs / 1000).toFixed(1) + "s",
                        ],
                      ].map(([l, v]) => (
                        <div className="stat" key={l}>
                          <span>{l}</span>
                          <b>{v}</b>
                        </div>
                      ))}
                      <p className="muted">
                        Video jump can be added once the source URL and player
                        seek support are verified.
                      </p>
                    </>
                  ) : (
                    <p>No matching points.</p>
                  )}
                </Panel>
                <Panel title="Point browser">
                  <div className="pointlist">
                    {filter.map((p, i) => (
                      <button
                        className={current === i ? "chosen" : ""}
                        onClick={() => setCurrent(i)}
                        key={p.id}
                      >
                        <b>#{p.number}</b>
                        <span>
                          {p.player === null
                            ? "Unclassified"
                            : name(data.players[p.player])}
                        </span>
                        <span>{p.outcome}</span>
                        <small>{p.shot ?? "—"}</small>
                      </button>
                    ))}
                  </div>
                </Panel>
              </div>
              <Panel
                title="Shot direction · Inferred"
                sub="Consecutive hitters + court positions at the time of each tap. Final shots, same-team sequences and unclear positions remain unknown."
              >
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Cross-court</th>
                      <th>Down the line</th>
                      <th>Unknown</th>
                      <th>Known direction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.directions.players.map((t, i) => (
                      <tr key={i}>
                        <td>{data.players[i].name}</td>
                        <td>{t.crossCourt}</td>
                        <td>{t.downTheLine}</td>
                        <td>{t.unknown}</td>
                        <td>{pct(t.crossCourt + t.downTheLine, t.shots)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted">
                  {d.directions.shots} shot taps across{" "}
                  {d.directions.trackedRallies} rallies. No exact trajectory or
                  landing zone is claimed.
                </p>
              </Panel>
              <Panel
                title="Rally length · tracked hitters"
                sub="Counts recorded taps. Serve-inclusive rally length is not guaranteed."
              >
                <div className="strokes">
                  {[
                    [1, 3],
                    [4, 6],
                    [7, 9],
                    [10, 12],
                    [13, 999],
                  ].map(([lo, hi]) => (
                    <div key={lo}>
                      <span>{hi === 999 ? "13+" : lo + "–" + hi} taps</span>
                      <b>
                        {
                          d.taps.filter(
                            (t) =>
                              t.touches.length >= lo && t.touches.length <= hi
                          ).length
                        }
                      </b>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="Recorded finishing strokes">
                <div className="strokes">
                  {[...new Set(filter.map((p) => p.shot).filter(Boolean))].map(
                    (shot) => (
                      <div key={shot}>
                        <span>{shot}</span>
                        <b>{filter.filter((p) => p.shot === shot).length}</b>
                      </div>
                    )
                  )}
                </div>
                <p className="muted">
                  Counts finishing strokes only. Expert taps identify hitters,
                  not every stroke type or ball coordinates.
                </p>
              </Panel>
            </>
          )}
          {tab === "Data coverage" && (
            <>
        {data.partial && (
          <p className="coverageNotice">
            {data.finished ? "Scouting completed" : "Scouting in progress"}
            {" · "}
            {data.scoreOnlyPoints > 0 && <>{data.scoreOnlyPoints} {data.scoreOnlyPoints === 1 ? "point has" : "points have"} score only. Player statistics exclude {data.scoreOnlyPoints === 1 ? "that point" : "those points"}.</>}
            {data.hasScoreAdjustments && <>{data.scoreOnlyPoints > 0 ? " " : ""}The score includes a starting score or manual corrections; these do not add recorded points or player statistics.</>}
          </p>
        )}
              <Panel title="Two sources, clearly separated">
                <div className="seg">
                  <button
                    className={source === "scout" ? "active" : ""}
                    onClick={() => setSource("scout")}
                  >
                    Scouting
                  </button>
                  <button
                    className={source === "pbp" ? "active" : ""}
                    onClick={() => setSource("pbp")}
                  >
                    Point-by-point
                  </button>
                </div>
                <div className="bigstat">
                  {source === "scout"
                    ? data.scopes.all.points.length
                    : data.pbpCount}
                  <span>
                    {source === "scout" ? "Scouted points" : "PBP records"}
                  </span>
                </div>
                <p>
                  {source === "scout"
                    ? "Scouting adds outcomes, recorded strokes, assists, smash attempts and weighted player impact."
                    : "PBP supports score evolution, team point runs and pressure situations where the required fields are present. It does not supply stroke types or Player Score."}
                </p>
                {source === "pbp" && data.pbpCount > 0 && (
                  <>
                    <h3>PBP momentum · recorded sequence</h3>
                    <Chart
                      series={[
                        (data.pbp ?? []).map((_, i) =>
                          (data.pbp ?? [])
                            .slice(Math.max(0, i - 9), i + 1)
                            .reduce(
                              (v, p) => v + (p.winner_pair === 1 ? 1 : -1),
                              0
                            )
                        ),
                      ]}
                      labels={(data.pbp ?? []).map((_, i) => i + 1)}
                    />
                    <p className="muted">
                      Positive: official pair 1 · Negative: official pair 2.
                      This uses the last ten available records; missing points
                      can distort runs.
                    </p>
                  </>
                )}
                <p className="muted">
                  Official duration: {data.meta.duration ?? "not available"}.
                  Scouting elapsed time:{" "}
                  {data.elapsedMs === null
                    ? "not recorded"
                    : Math.round(data.elapsedMs / 60000) + " minutes"}
                  . {data.scopes.all.points.length} scouted points and{" "}
                  {data.pbpCount} official PBP records are separate
                  observations.
                </p>
              </Panel>
              <Panel title="What we can build now">
                <div className="capgrid">
                  {[
                    [
                      "From PBP",
                      "Score progression · point runs · breaks · pressure moments · service/return team results",
                    ],
                    [
                      "From scouting",
                      "Team summary · Player Score · assists · smash effectiveness · outcome / finishing-stroke filters",
                    ],
                    [
                      "With Expert taps",
                      "Tracked rally length · hitter sequences · inferred cross-court / line direction",
                    ],
                    [
                      "Needs new capture",
                      "Ball landing heatmaps · exact trajectories · forehand/backhand splits · net occupancy",
                    ],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <h3>{l}</h3>
                      <p>{v}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}
          {tab === "Reports" && reports}
        </div>
        <footer>
          <Info size={16} /> Statistics cover saved observations. Shot
          directions are inferred; scores use the selected methodology. Saved{" "}
          {new Date(data.updatedAt).toLocaleString("en-GB", {
            timeZone: "Europe/Madrid",
          })}
          .
        </footer>
      </div>
    </div>
  );
}
