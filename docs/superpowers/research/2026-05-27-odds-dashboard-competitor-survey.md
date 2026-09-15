# Competitor Odds-Dashboard Survey

**Date:** 2026-05-27
**Purpose:** Visual + UX inspiration for evolving PadelNachos admin `/odds` pages and the eventual public-facing version.

## Executive summary

Four patterns kept recurring: (1) **dense, scannable rows** with color coding for value/movement, not charts as the primary surface; (2) **time-series win-probability lines** anchored to a 50% midline with leverage strips underneath; (3) **side-by-side player/pair cards with one clear "favorite" emphasis**; (4) **calibration / methodology tucked into secondary tabs**. B2B tools (OpticOdds, Sportradar) prioritize density and operator workflow; public fan tools (538, IBM Slamtracker, Inpredictable) lead with one narrative chart per match. Padel-specific competitors barely exist — the closest analogs are tennis (IBM/AELTC Slamtracker) and per-match exchange ladders (Betfair).

## Category 1: B2B sports-data / trading platforms

### OpticOdds Trading Screen
- **Visual:** Wide table of live event rows × sportsbook columns, sub-second update flashes (green = price moved better, red = worse). "MyView" tabs across the top let traders save sport/market/region presets. Outlier and arbitrage cells get a colored ring; Slack alert icons on the row indicate active notifications. ([opticodds.com/odds-screen](https://opticodds.com/odds-screen))
- **What stands out:**
  - Sub-second price-change flash animation per cell — the screen feels alive without being noisy
  - "Consensus line" column derived from 200+ books shown alongside individual books — gives traders a built-in baseline
  - Saveable preset tabs (MyView) so each user gets their own dashboard shape
- **Worth borrowing:** A "fair line" / consensus column in our per-tournament pair table; subtle row flash animation on Elo/champ% movement so updates feel live without the chart being open.

### Sportradar Live Match Tracker (LMT) — tennis variant
- **Visual:** Court-shaped graphic surface tinted by surface (clay = orange, grass = green, hard = blue), live ball spot, set tally pills above court, momentum strip beneath, and a sticky compact variant for mobile that pins to the top while the rest of the page scrolls. ([store.sportradar.com](https://store.sportradar.com/en/live-match-trackers/tennis/widgets/live-match-tracker-essential.php))
- **What stands out:**
  - Surface color as the chart background — instantly communicates context at a glance
  - Compact "sticky-top" variant on mobile so the live state never leaves the viewport while users scroll markets
  - Discrete event animations (ace, break point) layered over a static court
- **Worth borrowing:** A surface-tinted backdrop on the match detail page; a sticky compact "current state" header that follows the user down the page (match status + current score + favorite odds chip).

## Category 2: Sharp sportsbooks / exchanges

### Betfair Exchange — ladder interface (via Bet Angel / Geeks Toy)
- **Visual:** Vertical price ladder per selection, **green back column on left + blue lay column on right**, traded volume in the center column, matched volume shading deepens at recently-traded prices. ([apps.betfair.com](https://apps.betfair.com/learning/trading-software-how-to-use-the-ladder-interface/), [betangel.com depth view](https://www.betangel.com/user-guide/show_full_market_depth_and_volume.html))
- **What stands out:**
  - Two-side ladder (back vs lay) instantly communicates market depth and direction
  - Volume column tells the eye where money actually went, not just where it sits
  - Hot-key affordances visible inline — power users never leave the keyboard
- **Worth borrowing:** A two-side visualization on the per-match page where pair A vs pair B implied probability is shown as a back-to-back bar (filled center → favorite). For phase 2: surface "volume" equivalent — recent prediction-market depth or share of admin opinions if/when we ingest a market.

### Pinnacle In-Play
- **Visual:** Clean, sparse two-column layout — left rail tournament/league tree, center pane match cards with collapsed market accordions. Toggle for American/decimal odds and dark mode is a first-class header control. Live odds update with a brief highlight pulse. ([sportsbookreview.com](https://www.sportsbookreview.com/betting-sites/pinnacle/), [completesports.com review](https://www.completesports.com/pinnacle-sportsbook-review-2025/))
- **What stands out:**
  - The minimalism — there is essentially zero promotional clutter, which sharp users explicitly cite as the reason they trust it
  - Format toggle (decimal/american) lives in the header, not buried in settings
  - Collapsed-by-default markets — users expand only what they care about
- **Worth borrowing:** Lean into our existing pragmatism — a decimal/American toggle in the `/odds` header, accordion-collapsed secondary markets (sets handicap, total games) on the match detail page rather than long stacked sections.

## Category 3: Sports-modeling / win-probability sites

### FiveThirtyEight live NBA win probability
- **Visual:** Stepped-line chart, x-axis = game clock with quarter dividers, y-axis = 0-100% win probability anchored at a 50% midline. Two team colors fill above/below the 50% line. Score difference graph above, **leverage strip below** (Fangraphs-style). Top-plays table to the right showing biggest probability swings of the game. ([fivethirtyeight.com NBA model](https://fivethirtyeight.com/methodology/how-our-nba-predictions-work/), [example chart](https://fivethirtyeight.com/?ai2html=https%3A%2F%2Ffivethirtyeight.com%2Fwp-content%2Fuploads%2F2023%2F04%2Fbest-boice_NBA-LIVE-MODEL-STORY_0411_3-3.html))
- **What stands out:**
  - The 50% midline is the canvas; the line oscillating across it tells the story without any words
  - Top-plays table re-anchors the chart in narrative — "this is when the game turned"
  - Stepped (not smoothed) line — matches the discreteness of basketball possessions; would map perfectly to padel points
- **Worth borrowing:** Public-facing version of `/odds/match/[id]` should center on this exact chart — point-by-point stepped probability with a 50% midline, two-color fill, and a "top 5 swings" sidebar listing the points that moved the needle most.

### Inpredictable NBA Win Probability
- **Visual:** Two toggleable modes — "50/50" (assumes neutral matchup) and "Adjusted" (uses pre-game spread). Optional "show both" overlay. Below the chart: a leverage strip and a top-five-plays table ranked by probability impact. ([inpredictable.com](https://www.inpredictable.com/2015/05/nba-live-win-probabilities-mark-ii.html))
- **What stands out:**
  - The toggle between "neutral-matchup view" and "real-prior view" lets fans separate "what happened on court" from "who was favored coming in"
  - Leverage as a small bar strip rather than a second full chart — saves vertical space
- **Worth borrowing:** Same toggle pattern on our match page — "view as 50/50 prior" vs "use our pre-match Elo prior" — would let admins inspect model behavior in isolation. Leverage strip pattern is a free addition under the main chart.

### IBM Slamtracker / Match Insights (Wimbledon, US Open)
- **Visual:** Player cards top + bottom with photos and country flags, **"Live Likelihood to Win" gauge** between them (semi-circular meter, AI-generated bullet-point narrative beneath), keys-to-the-match list, momentum line graph point-by-point. ([ibm.com/sports/wimbledon](https://www.ibm.com/sports/wimbledon), [stocktitan IBM 2025](https://www.stocktitan.net/news/IBM/the-all-england-lawn-tennis-club-and-ibm-launch-new-ai-features-for-nhq5ucfuxvp4.html))
- **What stands out:**
  - Player-card-anchored layout is the closest mainstream analog to our pair-card layout — translates almost 1:1 to padel pairs
  - "Keys to the match" bullet list adds qualitative reasoning beside the quantitative chart
  - GenAI-written pre-match preview + post-match recap as embedded copy
- **Worth borrowing:** Player photos + flag on the pair cards (we already have avatars). Pre-match "key factors" bullet list driven from feature attributions (h2h, recent form, surface). Phase 3: GenAI-authored 2-bullet pre/post recap.

## Category 4: Odds-comparison & value-detection

### OddsJam Odds Screen
- **Visual:** Matrix of games × sportsbooks. Cells use traffic-light coding — **green = better than consensus by X%, yellow = solid, red = worse**. Faint shades for small edges, bold shades for large. EV column on the far right; "+EV" bets are bold green. Line-movement boxes flash green/red on each edge change. ([oddsjam.com line movement](https://oddsjam.com/betting-education/how-to-use-the-oddsjam-screen-line-movement), [oddsjam fantasy screen guide](https://oddsjam.com/betting-education/how-to-use-the-oddsjam-fantasy-screen))
- **What stands out:**
  - Color intensity scales with edge magnitude — a glance tells you the size of the gap, not just its direction
  - Bold-vs-faint axis layered on the color axis = encodes two dimensions in one cell
  - Line-movement boxes act as both indicator and historical record
- **Worth borrowing:** Today's-matches list could shade rows or the "fair odds" cell with edge intensity — pair-card backgrounds tint green when implied odds disagree with our model by ≥ X%. Phase 2 (public): a "value picks" badge on cards where our champ% strongly diverges from market.

### Action Network PRO Report
- **Visual:** Horizontally scrolling per-sportsbook odds carousel, "best odds" cell visually pinned/highlighted, BetSync-tracked wagers shown inline beside current-best alternative, public-betting percentage bars (left = % bets, right = % money), opening vs current line side-by-side. ([actionnetwork.com/odds](https://www.actionnetwork.com/odds), [Action Network PRO docs](https://actionnetworkhq.zendesk.com/hc/en-us/articles/360048458772-PRO-Report-on-the-web))
- **What stands out:**
  - "Best odds" highlighting is a single bright outline around one cell — very low-noise way to surface the call to action
  - Opening vs current line as paired numbers with a delta — communicates movement without a chart
  - Bet-vs-money split bars communicate sharp/square divergence in one widget
- **Worth borrowing:** On `/odds/tournament/[id]`, show **opening champ% → current champ% with delta arrow** beside the pair name (cheaper visual than the existing chart, and lives in the row). The "single bright outline" pattern fits our "favorite pill" today.

## Category 5: Tennis-specific live win probability

### IBM Slamtracker — see Category 3 above
(Same product spans modeling and tennis-specific; the tennis instance is the most relevant single reference in this whole survey for our pair-card + likelihood-to-win layout.)

### Sportradar Tennis LMT — see Category 1 above
(Court-shaped surface backdrop is tennis-native; translates to a padel-court SVG behind the match detail page.)

### Tennis Abstract (Jeff Sackmann)
- **Visual:** Stark, academic — tables of Elo ratings, surface-split Elo (overall / hard / clay / grass as separate columns), point-by-point CSVs. No live UI; the data archive feeding everyone else's models. ([jeffsackmann.com](https://www.jeffsackmann.com/), [GitHub data](https://github.com/JeffSackmann/tennis_atp))
- **Worth borrowing:** Surface-split (indoor/outdoor) Elo column pair on the tournament page once we have enough data — costs nothing visually and lets admins sanity-check the model's surface adjustment.

## Category 6: Padel-specific

Searched: Premier Padel app, Padel LiveScore, A1 Padel TV. **None of them ship a live win probability or odds widget today.** Premier Padel's "Predict" feature is a fan-pick-em game (binary fan guess, not a model). World Padel Tour is merged into Premier Padel. PadelBet specialty sites don't expose a public dashboard. ([Premier Padel App Store](https://apps.apple.com/uy/app/premier-padel/id6504236153), [Padel LiveScore](https://padel-livescore.com/))

**Implication:** the public-facing phase-2 dashboard would be **the first padel-native win-probability surface**. There's no domain UX convention to break — we set it. Tennis (IBM Slamtracker) is the canonical analog to anchor to.

## Key takeaways for PadelNachos

**Phase 1 — internal admin polish (next 1-2 sprints):**
- Add a "fair odds" / consensus baseline column to the tournament pair table — even if "consensus" is just "average of our model + Elo-only model"
- Subtle row-flash animation when champ% or Elo moves on the tournament page (OpticOdds-style)
- Shade or outline today's-matches rows by edge magnitude when implied odds diverge from market (once we ingest one)
- Pre-match "key factors" bullet list under each pair card on `/odds/match/[id]` driven from model feature attributions

**Phase 2 — public-facing fan UI:**
- Center the public match page on a stepped point-by-point win-probability line chart, 50% midline, two-color fill (FiveThirtyEight pattern)
- Surface-tinted court SVG backdrop on the match detail page (Sportradar LMT pattern, padel-court geometry)
- Side-by-side pair cards top/bottom with photos + flags, semi-circular "likelihood to win" gauge between them (IBM Slamtracker pattern)
- "Top 5 swing points" sidebar listing the highest-leverage points of the match
- Sticky compact header on mobile so the current score + favorite chip never scrolls off
- Decimal/American odds toggle as a first-class header control

**Phase 3 — betting partnership integration:**
- Back/lay style two-side bar visualization where the operator's price sits next to our model price — one bright outline on the "value side" (Action Network pattern, OddsJam intensity)
- "Opening → current" delta on every champ% and pair-match price (Action Network PRO)
- Leverage strip under the win-probability chart (Inpredictable / Fangraphs pattern) so partners can pitch in-play markets at high-leverage moments
- GenAI pre-match preview + post-match recap (IBM Slamtracker pattern) — 2-3 bullets, cheap to render, high perceived value
