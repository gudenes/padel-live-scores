/**
 * Shapes returned by the ad-hoc webtuga tournament tracker
 * (e.g. https://portugalmasterpadel.win.webtuga.net).
 * Captured 2026-06-16 from the FIP Platinum Lusitania event.
 */

/** One row of GET /api/public/results-feed (all matches for the event). */
export interface WebtugaFeedRow {
  id: number;
  court: string;
  time: string;
  round: string;
  category: string; // "Femininos" | "Masculinos"
  status: string; // "Live" | "Scheduled" | "Finished"
  teamA: string; // "A. Garcia / C. Sánchez"
  teamB: string;
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  pointsA: string; // "15" | "40" | "Ad" | "0"
  pointsB: string;
  setsHistoryA: string; // completed-set games, e.g. "6" or "6,4"
  setsHistoryB: string;
  live: boolean;
  finished: boolean;
  updatedAt: string;
}

/** GET /api/public/matches/{id} — richer per-match state. */
export interface WebtugaMatchDetail {
  id: number;
  status: string;
  state: {
    setsA: number;
    setsB: number;
    gamesA: number;
    gamesB: number;
    displayPointsA: string;
    displayPointsB: string;
    isTieBreak: boolean;
    serverTeam: string; // "A" | "B" | ""
    setsHistoryA: string;
    setsHistoryB: string;
  };
}
