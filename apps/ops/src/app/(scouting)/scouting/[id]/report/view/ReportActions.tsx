"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { DownloadSimple, CaretDown } from "./Icons";
import layout from "../report.module.css";
export function ReportActions({
  loading,
  scope,
  canExport,
  hasScout,
  hasPbp,
  onRefresh,
  onJson,
  onScoutCsv,
  onPbpCsv,
}: {
  loading: boolean;
  scope: string;
  canExport: boolean;
  hasScout: boolean;
  hasPbp: boolean;
  onRefresh: () => void;
  onJson: () => void;
  onScoutCsv: () => void;
  onPbpCsv: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const close=(event:PointerEvent)=>{if(menu.current?.open&&!menu.current.contains(event.target as Node))menu.current.open=false};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
  const run = (action: () => void) => {
    action();
    if (menu.current) menu.current.open = false;
  };
  return (
    <div className={layout.headerActions}>
      <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
        Refresh server copy
      </Button>
      <details
        ref={menu}
        className={layout.exportMenu}
        onKeyDown={(e) => {
          if (e.key === "Escape" && menu.current) {
            menu.current.open = false;
            menu.current.querySelector("summary")?.focus();
          }
        }}
      >
        <summary
        role="button"
          className="ui-btn"
          data-variant="primary"
          aria-label="Export match data"
        >
          <DownloadSimple size={18} />
          Export
          <CaretDown size={14} />
        </summary>
        <div className={layout.exportOptions}>
          <strong>Export match data</strong>
          <span>
            {scope === "all" ? "Full match" : "Set " + scope} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canExport}
            onClick={() => run(onJson)}
          >
            All match data (JSON)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasScout}
            onClick={() => run(onScoutCsv)}
          >
            Scouted points (CSV)
          </Button>
          {!hasScout && <small>Unavailable — match not scouted</small>}
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasPbp}
            onClick={() => run(onPbpCsv)}
          >
            Official PBP (CSV)
          </Button>
          {!hasPbp && <small>No PBP data available</small>}
          <small>
            JSON includes the full match. CSV uses the selected set.
          </small>
        </div>
      </details>
    </div>
  );
}
