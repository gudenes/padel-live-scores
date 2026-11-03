import { load } from "cheerio";
import {
  cupTeamKey,
  type CupTeam,
  type CupTie,
  type CupGroup,
  type CupCategory,
} from "./world-cup";
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const category = (s: string): CupCategory | null =>
  /\bWOMEN\b/i.test(s) ? "women" : /\bMEN\b/i.test(s) ? "men" : null;
/** HTML only: no script execution, no upstream markup returned to clients. */
export function parseCupTeams(html: string): CupTeam[] {
  const $ = load(html);
  const teams: CupTeam[] = [];
  $(".tab-pane").each((_, pane) => {
    const id = $(pane).attr("id");
    const gender = category($(`[data-target="#${id}"]`).text());
    if (!gender) return;
    $(pane)
      .find(".card")
      .each((_, card) => {
        const header = $(card).find(".card-header");
        const name = clean(header.find(".h4").text());
        const country =
          header
            .find("img")
            .attr("src")
            ?.match(/\/([A-Z]{2,3})\.jpg/i)?.[1] ?? null;
        const players: string[] = [];
        $(card)
          .find(".card-body > .m-2")
          .each((_, row) => {
            const first = clean($(row).children(".mr-2").text());
            const last = clean($(row).children(".text-uppercase").text());
            if (first && last) players.push(`${first} ${last}`);
          });
        if (name) teams.push({ name, country, players, category: gender });
      });
  });
  return teams;
}
export function parseCupStreams(html: string, observedAt = new Date()): CupTie[] {
  const $ = load(html);
  const ties = new Map<string, CupTie>();
  $(".bw-yt-item").each((_, item) => {
    const card = $(item).find("a[data-yt]").first();
    const videoId = card.attr("data-yt") ?? "";
    const title = card.attr("data-title") ?? "";
    // FIP prefixes broadcast language, not a national-team identifier.
    const languagePrefix = title.match(/^\s*[[(](ENG|ESP|EN|ES|POR|PT|FRA|FR|ITA|IT|GER|DE|ARA|AR)[\])]\s*/i);
    const language = languagePrefix?.[1].toUpperCase() ?? null;
    const parts = title.slice(languagePrefix?.[0].length ?? 0).split(/\s+vs\s+/i);
    if (parts.length !== 2 || !/^[-\w]{11}$/.test(videoId)) return;
    const tags = clean(card.find(".bw-yt-tags").text());
    const gender = category(tags);
    if (!gender) return;
    const scheduledAt = card.find("time").attr("datetime");
    const live = card.find('.bw-yt-badge--live').length > 0;
    const scheduled = scheduledAt && Number.isFinite(Date.parse(scheduledAt)) ? new Date(scheduledAt).toISOString() : null;
    // FIP removes <time> when a stream moves into Live now. Do not invent a start time.
    if (!scheduled && !live) return;
    const home = clean(parts[0].replace(/[^\p{L}\p{N}\s.'-]/gu, ""));
    const away = clean(parts[1].replace(/[^\p{L}\p{N}\s.'-]/gu, ""));
    if (!home || !away) return;
    const id = `${gender}-${cupTeamKey(home).replaceAll(" ", "-")}-${cupTeamKey(
      away
    ).replaceAll(" ", "-")}`;
    const previous = ties.get(id);
    const streams = previous?.streams ? [...previous.streams] : [];
    if (!streams.some(stream => stream.videoId === videoId)) streams.push({ videoId, language });
    ties.set(id, {
      id,
      category: gender,
      group: tags.match(/GROUP\s+([A-Z])\b/i)?.[1] ?? null,
      home,
      away,
      scheduledAt: previous?.scheduledAt ?? scheduled,
      ...(live || previous?.liveObservedAt ? { liveObservedAt: observedAt.toISOString() } : {}),
      videoId: previous?.videoId ?? videoId,
      streams,
    });
  });
  return [...ties.values()].sort((a, b) =>
    (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')
  );
}
export function parseCupGroups(html: string): CupGroup[] {
  const $ = load(html);
  const groups: CupGroup[] = [];
  $("[data-draw]").each((_, draw) => {
    const gender = category($(draw).find(".h4").first().text());
    if (!gender) return;
    $(draw)
      .find(".group-caption")
      .each((_, caption) => {
        const teams: CupGroup["teams"] = [];
        $(caption)
          .next(".group-body")
          .children()
          .filter((_, row) => $(row).find(".group-team").length > 0)
          .each((_, row) => {
            const team = $(row).find(".group-team");
            const points = clean($(row).find(".group-pts").text());
            teams.push({
              name: clean(team.text()),
              country:
                team
                  .find("img")
                  .attr("src")
                  ?.match(/\/([A-Z]{2,3})\.jpg/i)?.[1] ?? null,
              points: /^\d+$/.test(points) ? Number(points) : null,
              rubbers: clean($(row).find(".group-rubs").text()),
            });
          });
        groups.push({
          name: clean($(caption).text()),
          category: gender,
          teams,
        });
      });
  });
  return groups;
}
