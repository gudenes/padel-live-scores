import React, { useEffect, useMemo, useRef, useState } from "react";
import { receiverCounts, contextRallies, recordedCourtSlots, compactPlayerName } from "@/lib/scouting/report-view";
const short = (p) => p.shortName || compactPlayerName(p.display_name || p.name);

export function DirectionCourt({
  players,
  rallies: allRallies,
  points,
}) {
  const [selected, setSelected] = useState(1),
    [phase, setPhase] = useState("all");
  const slots = useMemo(()=>recordedCourtSlots(allRallies),[allRallies]);
  const canvas = useRef();
  const rallies = contextRallies(allRallies, points, selected, phase);
  const {players: exchanges, incoming, excluded} = receiverCounts(rallies);
  const directions = {players: exchanges, shots: exchanges.reduce((sum,p)=>sum+p.shots,0)};
  const row = exchanges[selected];
  const known = row.receivers.reduce((sum,count)=>sum+count,0);
  const shares = row.receivers.map(count=>known ? 100*count/known : 0);
  const opponents = selected < 2 ? [2,3] : [0,1];
  const [firstShare,secondShare] = opponents.map(i=>shares[i]);
  useEffect(() => {
    const el = canvas.current;
    const draw = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      el.width = w * 2;
      el.height = h * 2;
      const c = el.getContext("2d");
      if (!c) return;
      c.scale(2, 2);
      const from = slots[selected];
      function arrow(toIndex, share, dotted) {
        if (!known || !share) return;
        const to = slots[toIndex],
          dx = (to.x - from.x) * w,
          dy = (to.y - from.y) * h,
          len = Math.hypot(dx, dy),
          ux = dx / len,
          uy = dy / len;
        const radius = (w < 420 ? 23 : 34) + len * 0.1;
        const sx = from.x * w + ux * radius,
          sy = from.y * h + uy * radius,
          ex = to.x * w - ux * radius,
          ey = to.y * h - uy * radius;
        const bend = (dotted ? -0.022 : 0.045) * w;
        const cx = (sx + ex) / 2 - uy * bend,
          cy = (sy + ey) / 2 + ux * bend;
        const tone = selected < 2 ? "#c4f63a" : "#ff897b";
        const stroke = w < 420 ? 2 : 3;
        const path = () => {
          c.beginPath();
          c.moveTo(sx, sy);
          c.quadraticCurveTo(cx, cy, ex, ey);
        };
        c.lineCap = "round";
        c.lineJoin = "round";
        c.setLineDash([]);
        c.strokeStyle = tone;
        c.globalAlpha = 0.12;
        c.lineWidth = stroke + 6;
        path();
        c.stroke();
        c.globalAlpha = 1;
        c.setLineDash(dotted ? [5, 7] : []);
        c.strokeStyle = tone;
        c.lineWidth = stroke;
        path();
        c.stroke();
        c.setLineDash([]);
        const angle = Math.atan2(ey - cy, ex - cx),
          head = w < 420 ? 8 : 11;
        c.fillStyle = tone;
        c.beginPath();
        c.moveTo(ex + Math.cos(angle) * 2, ey + Math.sin(angle) * 2);
        c.lineTo(
          ex - head * Math.cos(angle - 0.48),
          ey - head * Math.sin(angle - 0.48)
        );
        c.lineTo(
          ex - head * Math.cos(angle + 0.48),
          ey - head * Math.sin(angle + 0.48)
        );
        c.closePath();
        c.fill();
        const t = dotted ? 0.38 : 0.6;
        const lx = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * ex,
          ly = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ey;
        const label = share.toFixed(1) + "%",
          fontSize = w < 420 ? 12 : 15;
        c.font = "bold " + fontSize + "px Arial";
        const lw = c.measureText(label).width + 20,
          lh = fontSize + 14;
        c.fillStyle = "#172c3d";
        c.shadowColor = "rgba(0,25,50,.18)";
        c.shadowBlur = 5;
        c.beginPath();
        c.roundRect(lx - lw / 2, ly - lh / 2, lw, lh, 8);
        c.fill();
        c.shadowBlur = 0;
        c.fillStyle = "#fff";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(label, lx, ly + 1);
        c.textAlign = "left";
        c.textBaseline = "alphabetic";
      }
      // Percentage and endpoint belong to the same receiver, even after end switches.
      const receivers = selected < 2 ? [2,3] : [0,1];
      receivers.forEach((i,index)=>arrow(i,index===0?firstShare:secondShare,(slots[i].x>0.5)===(from.x>0.5)));
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(el);
    return () => resize.disconnect();
  }, [selected, firstShare, secondShare, known, slots]);
  return (
    <section className="panel directionExplorer">
      <div className="directionHeading">
        <div>
          <h2>Direction & player involvement</h2>
          <p className="muted">
            Compare recorded hits and identifiable incoming exchanges.
          </p>
        </div>
        <span className="detailbadge">Inferred directions</span>
      </div>
      <div
        className="courtPlayerTabs"
        aria-label="Select player for direction analysis"
      >
        {players.map((p, i) => (
          <button
            aria-pressed={selected === i}
            className={
              (selected === i ? "active " : "") +
              (i < 2 ? "courtLime" : "courtCoral")
            }
            onClick={() => setSelected(i)}
            key={p.id}
          >
            <img src={p.avatar} alt="" />
            {short(p)}
          </button>
        ))}
      </div>
      <div className="courtFilterBar">
        <div className="courtPhaseTabs" role="group" aria-label="Rally context">
          {[
            ["all", "All rallies"],
            ["serve", "Serving"],
            ["return", "Returning"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={phase === value}
              className={phase === value ? "active" : ""}
              onClick={() => setPhase(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted">
          {phase === "all"
            ? "All recorded rallies"
            : short(players[selected < 2 ? 0 : 2]) +
              " / " +
              short(players[selected < 2 ? 1 : 3]) +
              (phase === "serve" ? " serving" : " returning")}{" "}
          · {rallies.length} rallies
        </span>
      </div>
      <div className="courtAnalytics">
        <div className="courtPrimary">
          <div className="courtTitle">
            <strong>Shot direction · {short(players[selected])}</strong>
            <span>
              {known} known · {row.unknown} unknown
            </span>
          </div>
          <div className="courtScene">
            <img
              className="courtBackground"
              src="/scouting/court-empty.webp"
              alt="Blue padel court with glass walls and net"
            />
            {!known && (
              <div className="courtEmpty">
                No identifiable receivers in this selection.
              </div>
            )}
            <canvas
              ref={canvas}
              className="directionOverlay"
              aria-label={`Next recorded receiver: ${opponents.map(i=>players[i].name+' '+shares[i].toFixed(1)+'%').join(', ')}`}
              role="img"
            />
            {players.map((p, i) => (
              <button
                className={
                  "courtMarker " +
                  (i < 2 ? "courtLime" : "courtCoral") +
                  (selected === i ? " selected" : "")
                }
                style={{
                  left: slots[i].x * 100 + "%",
                  top: slots[i].y * 100 + "%",
                }}
                onClick={() => setSelected(i)}
                key={p.id}
                aria-label={"Select " + p.name}
              >
                <img src={p.avatar} alt="" />
                <span>{short(p)}</span>
              </button>
            ))}
          </div>
          <div className="courtFoot">
            <p className="muted">
              Arrows show the next recorded hitter. Percentages exclude unknown
              receivers. Serving / returning refers to the selected pair.
              Positions use the first recorded layout when available, with the lime pair at the near end; they are not tracked coordinates.
            </p>
          </div>
        </div>
        <aside className="courtComparisons">
          <h3>Recorded hits</h3>
          <p className="muted">
            Recorded taps by player · {directions.shots} total
          </p>
          {players.map((p, i) => (
            <button
              className={
                "hitRow " +
                (i < 2 ? "courtLime " : "courtCoral ") +
                (selected === i ? "selected" : "")
              }
              key={p.id}
              onClick={() => setSelected(i)}
              aria-label={"Inspect " + p.name}
            >
              <img src={p.avatar} alt="" />
              <div>
                <span>{short(p)}</span>
                <div className="hitTrack">
                  <i
                    style={{
                      width:
                        (100 * directions.players[i].shots) /
                          Math.max(
                            1,
                            ...directions.players.map((p) => p.shots)
                          ) +
                        "%",
                      background: i < 2 ? "#bcf52d" : "#ff897b",
                    }}
                  />
                </div>
              </div>
              <b>{directions.players[i].shots}</b>
            </button>
          ))}
          <div className="reception">
            <h3>Who receives the next shot?</h3>
            <p className="muted">
              Share within each pair · identifiable incoming exchanges
            </p>
            {[0, 2].map((i) => {
              const total = incoming[i] + incoming[i + 1],
                a = total ? (100 * incoming[i]) / total : 0;
              return (
                <div className="receptionPair" key={i}>
                  <div className="receptionLabels">
                    {[i, i + 1].map((k) => (
                      <div key={k}>
                        <img
                          src={players[k].avatar}
                          alt=""
                          style={{
                            border:
                              k < 2 ? "2px solid #bcf52d" : "2px solid #ff897b",
                          }}
                        />
                        <b>
                          {total
                            ? ((100 * incoming[k]) / total).toFixed(1) + "%"
                            : "—"}
                        </b>
                        <span>{short(players[k])}</span>
                        <small>{incoming[k]} connections</small>
                      </div>
                    ))}
                  </div>
                  <div className="receptionTrack">
                    <i
                      style={{
                        width: a + "%",
                        background: i === 0 ? "#bcf52d" : "#ff897b",
                      }}
                    />
                    <i
                      style={{
                        width: (total ? 100 - a : 0) + "%",
                        background: i === 0 ? "#8fae2b" : "#b95850",
                      }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="neveraNote">
              <strong>Look for changes across sets</strong>
              <p>
                Uneven reception may suggest a nevera pattern. It does not
                confirm tactical intent or identify the stronger player.
              </p>
              <small>
                First taps have no recorded sender. Same-team transitions (
                {excluded}) are excluded.
              </small>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
