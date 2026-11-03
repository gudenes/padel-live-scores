import { load } from 'cheerio';
export interface CupTie {
  id: string; category: 'men' | 'women'; group: string | null;
  home: string; away: string; scheduledAt: string | null;
  liveObservedAt?: string; videoId: string;
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const category = (s: string): 'men' | 'women' | null =>
  /\bWOMEN\b/i.test(s) ? 'women' : /\bMEN\b/i.test(s) ? 'men' : null;
const cupTeamKey = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
// Keep the app's parseCupStreams contract; fixture parity is tested.
export function parseCupStreams(html: string, observedAt = new Date()): CupTie[] {
  const $ = load(html);
  const ties = new Map<string, CupTie>();
  $(".bw-yt-item").each((_, item) => {
    const card = $(item).find("a[data-yt]").first();
    const videoId = card.attr("data-yt") ?? "";
    const parts = (card.attr("data-title") ?? "").split(/\s+vs\s+/i);
    if (parts.length !== 2 || !/^[-\w]{11}$/.test(videoId)) return;
    const tags = clean(card.find(".bw-yt-tags").text());
    const gender = category(tags);
    if (!gender) return;
    const scheduledAt = card.find("time").attr("datetime");
    const live = card.find('.bw-yt-badge--live').length > 0;
    const scheduled = scheduledAt && Number.isFinite(Date.parse(scheduledAt)) ? new Date(scheduledAt).toISOString() : null;
    // FIP removes <time> when a stream moves into Live now. Do not invent a start time.
    if (!scheduled && !live) return;
    const home = clean(parts[0]!.replace(/[^\p{L}\p{N}\s.'-]/gu, ""));
    const away = clean(parts[1]!.replace(/[^\p{L}\p{N}\s.'-]/gu, ""));
    if (!home || !away) return;
    const id = `${gender}-${cupTeamKey(home).replaceAll(" ", "-")}-${cupTeamKey(
      away
    ).replaceAll(" ", "-")}`;
    ties.set(id, {
      id,
      category: gender,
      group: tags.match(/GROUP\s+([A-Z])\b/i)?.[1] ?? null,
      home,
      away,
      scheduledAt: scheduled,
      ...(live ? { liveObservedAt: observedAt.toISOString() } : {}),
      videoId,
    });
  });
  return [...ties.values()].sort((a, b) =>
    (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')
  );
}
