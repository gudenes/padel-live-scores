"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import MethodologyGuide from "@/components/scouting/MethodologyGuide";
import MatchLibraryMenu from "../../MatchLibraryMenu";
import { useRouter } from "next/navigation";
import { savedReport, type SavedSession } from "@/lib/scouting/saved-report";
import { pointsCsv, sessionExport } from "@/lib/scouting/export";
import {
  DEFAULT_METHODOLOGY,
  methodologies,
  type MethodologyId,
} from "@/lib/scouting/methodology";
import { pbpAnalysis, pbpCsv, officialPoints } from "@/lib/scouting/pbp-report";
import ScoutLaunchMenu from "../../ScoutLaunchMenu";
import Insights from "../Insights";
import { MatchInsightsView } from "./view/MatchInsightsView";
import PbpInsightsView from "./view/PbpInsightsView";
import { ReportActions } from "./view/ReportActions";
import { reportView, type ReportContext } from "@/lib/scouting/report-view";
import styles from "../scout.module.css";
import layout from "./report.module.css";
type Report = ReturnType<typeof savedReport>;
const emptyContext: ReportContext = {
  meta: {
    duration: null,
    round: null,
    category: null,
    tournament: null,
    scheduled_at: null,
  },
  avatars: {},
  pbp: [],
};
export default function SavedScoutingReport({
  matchId,
  userId = "",
  manual = false,
  context = emptyContext,
}: {
  matchId: string;
  userId?: string;
  manual?: boolean;
  context?: ReportContext;
}) {
  const router = useRouter();
  const [canResume,setCanResume]=useState(false)
  const [resumeInExtension,setResumeInExtension]=useState(false);
  const [privateMatch, setPrivateMatch] = useState<{
    match_date?: string;
    tournament_label?: string;
  } | null>(null);
  const [methodology, setMethodology] =
      useState<MethodologyId>(DEFAULT_METHODOLOGY),
    [scope, setScope] = useState("all");
  const [report, setReport] = useState<Report | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setReport(null);
    setCanResume(false);
    setPrivateMatch(null);
    setError("");
    setScope("all");
    async function load() {
      for (const source of (manual ? ["video"] : ["video", "admin"]) as (
        | "video"
        | "admin"
      )[]) {
        const path =
          source === "video"
            ? manual
              ? "manual-video-scouting"
              : "video-scouting"
            : "scouting";
        const response = await fetch(
          `/api/internal/${path}/${encodeURIComponent(matchId)}`,
          { cache: "no-store", signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok)
          throw Error(data.error || "Could not load saved scouting.");
        if (active && manual) setPrivateMatch(data.match ?? null);
        if (data.session) {
          if (active){
            setReport(savedReport(data.session as SavedSession, source));
            setCanResume(!manual&&data.canResume===true);
            setResumeInExtension(data.session.document?.captureMode!=='standalone');
          }
          return;
        }
      }
    }
    load()
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load saved scouting."
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [matchId, manual, attempt]);
  const data = report ? reportView(report, context, methodology) : null;
  const pbp = officialPoints(context),
    hasMatch = (context.players?.length ?? 0) > 0,
    canExport = !loading && !error && (!!report || hasMatch);
  function download(
    content: string,
    extension: "json" | "csv",
    source: string,
    scoped = false
  ) {
    const url = URL.createObjectURL(
      new Blob([content], {
        type:
          extension === "json" ? "application/json" : "text/csv;charset=utf-8",
      })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${source}-${matchId}${
      scoped && scope !== "all" ? "-set-" + scope : ""
    }.${extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportAll() {
    const payload = report
      ? {
          ...sessionExport(
            matchId,
            report.players,
            report.revision,
            report.doc,
            methodology
          ),
          source: report.source,
          ...(manual ? { privateMatch, visibility: "private-scouting" } : {}),
          timestampBasis:
            report.source === "video"
              ? "Video position encoded as UTC from the Unix epoch; not wall-clock match time."
              : "Recorded wall-clock time.",
          originalDocument: report.original,
          videoReport: report.videoReport,
          officialContext: context,
        }
      : {
          schemaVersion: 1,
          matchId,
          source: "official-pbp",
          officialContext: context,
          summary: pbpAnalysis(context),
          scouting: null,
          availability: {
            playerScore: false,
            strokes: false,
            assists: false,
            courtDirections: false,
          },
        };
    download(JSON.stringify(payload, null, 2), "json", "match");
  }
  return (
    <main className={layout.page}>
      <header className={layout.header}>
        <div className={layout.headerIntro}>
          <MatchLibraryMenu userId={userId}/>
          <h1>Match insights</h1>
          <p>
            {manual
              ? "Private scouting"
              : report
              ? "Saved scouting & official match data"
              : "Official match & point-by-point"}
            {manual && privateMatch?.tournament_label
              ? " · " + privateMatch.tournament_label
              : ""}
            {manual && privateMatch?.match_date
              ? " · " + privateMatch.match_date
              : ""}
          </p>
        </div>
        <ReportActions
          resumeAction={!loading&&!error&&canResume&&report?.model.score.phase!=='finished'?<ScoutLaunchMenu matchId={matchId} continuing extension={resumeInExtension} label="Scouting options" placement="below"/>:undefined}
          loading={loading}
          scope={scope}
          canExport={canExport}
          hasScout={!!report}
          hasPbp={!!pbp.length}
          onRefresh={() => {
            router.refresh();
            setAttempt((n) => n + 1);
          }}
          onJson={exportAll}
          onScoutCsv={() =>
            report &&
            download(
              pointsCsv(
                report.players,
                report.doc,
                data?.scopes[scope]?.points
              ),
              "csv",
              "scouting",
              true
            )
          }
          onPbpCsv={() =>
            download(pbpCsv(context, scope), "csv", "official-pbp", true)
          }
        />
      </header>
      {report && (
        <div className={layout.methodBar}>
          <label>
            Methodology
            <select
              aria-label="Report methodology"
              value={methodology}
              onChange={(e) => setMethodology(e.target.value as MethodologyId)}
            >
              {methodologies.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <MethodologyGuide label="How scoring works" methodology={methodology}/>
        </div>
      )}
      {loading ? (
        <p role="status">Loading saved match data…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : report && data ? (
        <MatchInsightsView
          data={data}
          onScopeChange={setScope}
          reports={
            <Insights
              model={report.model}
              players={report.players}
              doc={report.doc}
              reviewedPointIds={report.reviewedPointIds}
              methodology={methodology}
              onMethodologyChange={setMethodology}
            />
          }
        />
      ) : hasMatch ? (
        <PbpInsightsView context={context} onScopeChange={setScope} />
      ) : (
        <section className={`ui-panel ${styles.chartPanel}`}>
          <h2>No saved scouting for this match</h2>
          <p>No official match data could be loaded. Refresh to retry.</p>
          {manual ? (
            <p>
              Open this match from Saved scouting sessions in the extension to
              begin.
            </p>
          ) : (
            <Link className="ui-btn" href={`/scouting/${matchId}`}>
              Open admin scouting
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
