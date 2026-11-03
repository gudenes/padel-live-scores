"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations, useTimeZone } from "next-intl";
import { Link } from "@/i18n/navigation";
import { FlagImage } from "@/components/FlagImage";
import {
  WORLD_CUP,
  cupTeamKey,
  cupSeed,
  type CupCategory,
  type CupData,
  type CupTeam,
} from "@/lib/world-cup";
import WorldCupTeam from './WorldCupTeam';
import type { Match } from '@/types/match';
import Avatar from "@/components/Avatar";
import { normalizeCountry } from "@/lib/country";
import { GREEN, BG_CARD, BORDER, MEN_BLUE, WOMEN_PURPLE, CHUNKY } from "@/components/home/shared";
import type { CSSProperties } from "react";
import styles from "./WorldCup.module.css";

export default function WorldCup({
  category,
  onCategoryChange,
  view,
  matches,
  userTz,
}: {
  matches: Match[];
  userTz: string;
  category: CupCategory;
  onCategoryChange: (category: CupCategory) => void;
  view: "squads" | "groups";
}) {
  const t = useTranslations("worldCup");
  const locale = useLocale();
  const timeZone = useTimeZone() ?? "UTC";
  const [data, setData] = useState<CupData | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState<CupTeam | null>(null);
  const [country, setCountry] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function refresh() {
      try {
        const r = await fetch("/api/world-cup", { signal: controller.signal });
        if (!r.ok) throw new Error();
        const d: CupData = await r.json();
        if (!cancelled) {
          setData(d);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void refresh();
    const interval = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [retry]);
  const teams = [...(data?.teams.filter((x) => x.category === category) ?? [])].sort((a, b) => (cupSeed(a.country, category) ?? 99) - (cupSeed(b.country, category) ?? 99) || a.name.localeCompare(b.name));
  const lookup = (name: string) =>
    teams.find((team) => cupTeamKey(team.name) === cupTeamKey(name));
  const countryName = (name: string) => {
    const code = lookup(name)?.country;
    try {
      return code
        ? new Intl.DisplayNames([locale], { type: "region" }).of(
            normalizeCountry(code) ?? code
          ) ?? name
        : name;
    } catch {
      return name;
    }
  };
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(new Date(value));
  const teamLabel = (name: string) => (
    <span className={styles.team}>
      <FlagImage country={lookup(name)?.country} size={24} />
      <span>{countryName(name)}</span>
    </span>
  );
  return (
    <section className={styles.root} aria-label="FIP World Cup 2026" style={{
      "--cup-green": GREEN, "--cup-bg": BG_CARD, "--cup-border": BORDER,
      "--cup-category": category === "women" ? WOMEN_PURPLE : MEN_BLUE,
      "--cup-button": CHUNKY.button,
    } as CSSProperties}>
      <header className={styles.heading}>
        <div>
          <small>{t("nationalTeams")}</small>
          <h2>FIP WORLD CUP 2026</h2>
        </div>
      </header>
      {(
        <div className={styles.gender} aria-label={t("category")}>
          {(["men", "women"] as const).map((g) => (
            <button
              key={g}
              aria-pressed={category === g}
              onClick={() => {
                onCategoryChange(g);
              }}
            >
              {t(g)}
            </button>
          ))}
        </div>
      )}
      {!data && !failed && (
        <p role="status" className={styles.notice}>
          {t("loading")}
        </p>
      )}
      {(failed || data?.partial) && (
        <div role="status" className={styles.notice}>
          {t(data ? "partial" : "error")}{" "}
          <button onClick={() => setRetry((n) => n + 1)}>{t("retry")}</button>
        </div>
      )}
      {data && (
        <>
          {view === "squads" && (
            <div>
              <p className={styles.notice}>{t("squadHelp")}</p>
              {teams.map(squad => {
                const key = `${category}-${squad.name}`;
                const expanded = country === key;
                const seed = cupSeed(squad.country, category);
                const panelId = `squad-${category}-${cupTeamKey(squad.name).replaceAll(' ', '-')}`;
                return <div className={styles.countrySection} key={key}>
                  <button className={styles.countryToggle} aria-expanded={expanded} aria-controls={panelId} onClick={() => setCountry(expanded ? '' : key)}>
                    {teamLabel(squad.name)}
                    {seed && <span className={styles.seed}>#{seed}</span>}
                    <span aria-hidden className={styles.expandIcon} data-open={expanded}>⌄</span>
                  </button>
                  <div className={styles.collapse} data-open={expanded} id={panelId} inert={!expanded} aria-hidden={!expanded}>
                    <div className={styles.collapseInner}>
                <button className={styles.teamDetails} onClick={() => setSelectedTeam(squad)}>{t("teamDetails")} ↗</button>
                <ul className={styles.roster}>
                  {squad.players.map((name) => {
                    const profile = squad.profiles?.[name];
                    const content = <>
                      <Avatar src={profile?.avatarUrl} alt={profile?.name ?? name} size={44} />
                      <span className={styles.playerName}>{profile?.name ?? name}</span>
                      <FlagImage country={squad.country} size={18} />
                      {profile && <span aria-hidden className={styles.chevron}>›</span>}
                    </>;
                    return <li key={name}>{profile
                      ? <Link className={styles.playerRow} href={`/player/${profile.id}`}>{content}</Link>
                      : <div className={styles.playerRow}>{content}</div>}
                    </li>;
                  })}
                </ul>
                    </div>
                  </div>
                </div>;
              })}
              {teams.length === 0 && <p className={styles.notice}>{t("noSquad")}</p>}
            </div>
          )}
          {view === "groups" && (
            <div>
              {data.groups
                .filter((g) => g.category === category)
                .map((g) => {
                  const key = `${category}-${g.name}`;
                  const expanded = openGroups.has(key);
                  const panelId = `group-${encodeURIComponent(key)}`;
                  const label = g.name.replace("Group", t("group"));
                  return <div key={key} className={styles.group}>
                    <h3 className={styles.groupHeading}>
                      <button className={styles.groupToggle} aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpenGroups(previous => {
                        const next = new Set(previous);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      })}>
                        <span>{label}</span>
                        <span className={styles.groupFlags} aria-hidden="true">{g.teams.map(team => <FlagImage key={team.name} country={lookup(team.name)?.country} size={24} />)}</span>
                        <span className={styles.groupExpand} aria-hidden="true">{expanded ? '−' : '+'}</span>
                      </button>
                    </h3>
                    <div className={styles.collapse} data-open={expanded} id={panelId} inert={!expanded} aria-hidden={!expanded}>
                    <div className={styles.collapseInner}>
                    <table aria-label={label}>
                      <thead>
                        <tr>
                          <th>{t("country")}</th>
                          <th>{t("points")}</th>
                          <th>{t("rubbers")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.teams.map((team) => (
                          <tr key={team.name}>
                            <td><button className={styles.teamLink} onClick={() => { const squad = lookup(team.name); if (squad) setSelectedTeam(squad); }} disabled={!lookup(team.name)}>{teamLabel(team.name)}<span aria-hidden="true">›</span></button></td>
                            <td><strong className={styles.groupPoints}>{team.points ?? "—"}</strong></td>
                            <td>{team.rubbers || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    </div>
                  </div>;
                })}
            </div>
          )}
          {selectedTeam && <WorldCupTeam team={selectedTeam} data={data} matches={matches} userTz={userTz} onClose={() => setSelectedTeam(null)} />}
          <p className={styles.source}>
            <a
              href={WORLD_CUP.eventUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("source")} ↗
            </a>
            <span>
              {t("updated")} {date(data.fetchedAt)}
            </span>
          </p>
        </>
      )}
    </section>
  );
}
