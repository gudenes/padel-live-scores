# PadelNachos — UI Redesign Prompt for Lovable

## Brand Identity

**App Name:** PadelNachos
**Logo:** Attached images — bold street-style logotype in white (PADEL) + orange (NACHOS) with lime green outline and black shadows. The icon is a padel racket shaped like a nacho chip with salsa, in orange/green/black.
**Brand personality:** Fun, bold, snackable live sports content — think ESPN meets TikTok for padel.

## Color Palette (extracted from logo)

- **Primary dark background:** `#0A0A0A` (near-black, the dominant surface)
- **Lime green accent:** `#7ED321` / `#8BC34A` (from logo outline — use for active states, navigation indicators, "you are here" highlights)
- **Orange/amber:** `#F5A623` / `#FF9800` (from "NACHOS" text — use for CTAs, featured content, badges)
- **Salsa red:** `#FF4655` (from racket icon — use sparingly for LIVE indicators, alerts)
- **White:** `#FFFFFF` (primary text on dark)
- **Muted gray:** `#6B7280` (secondary text, borders)
- **Card surface:** `#141414` or `#1A1A1A` (slightly lifted from base)

**Rule:** The green is the primary accent for navigation and active states. Orange is for highlights and featured content. Red is ONLY for live/urgent indicators.

## Design Inspiration

Take cues from these apps:

1. **Revolut** — Clean card-based home screen where everything is accessible from one scrollable page. Smooth transitions when drilling into details. Minimal chrome. The home feed IS the app.
2. **Spotify** — Dark theme done right. Horizontal scrollable shelves for content discovery. Bold typography. Personalized sections. The way "Your Library" and "Home" coexist.
3. **FotMob / SofaScore** — Live score apps: real-time score tickers, match cards with live dots, tournament grouping. But PadelNachos should feel more premium and less data-dense.
4. **Apple Sports** — Ultra-clean live scores with big typography and smart use of color for team identity.

## App Architecture — Home-Centric Single-Page Feel

**Core principle:** The Home page IS the app. Users scroll through a curated feed of live scores, upcoming matches, news, and rankings. Tapping anything opens a detail view with a clear back-to-home pattern. No 5-tab paradigm — just 2 bottom icons + profile.

### Bottom Navigation (simplified to 3 items max)

```
┌─────────────────────────────────────┐
│  [Scores]        [Home]      [Feed] │
│   icon            icon        icon  │
└─────────────────────────────────────┘
```

- **Home** (center, prominent): The main hub — curated feed of everything
- **Scores** (left): Dedicated live scores + results view grouped by tournament
- **Feed** (right): News articles + YouTube highlights stream

Active tab indicator: **lime green** pill/underline/dot — the green from the logo.

### Profile Icon Location

**Top-right of the header**, like Revolut/Spotify. Small circular avatar (32px). Tapping opens a slide-in profile panel or full profile page. This keeps the bottom nav clean and puts identity where users expect it (top-right).

### Header Bar (persistent across all pages)

```
┌─────────────────────────────────────┐
│  [🔍]    PADELNACHOS logo    [👤]   │
└─────────────────────────────────────┘
```

- Left: Search icon (opens overlay)
- Center: PadelNachos logo (compact horizontal version)
- Right: Profile avatar
- Background: dark with subtle blur, sticky on scroll

## Page Designs

### 1. HOME PAGE — The Hub

The home page is a single scrollable feed with distinct sections. Think Spotify's home page meets a live sports dashboard.

**Section order:**

#### A. Live Now (top priority, only shows when matches are live)
- Full-width hero card with subtle red glow/border
- Pulsing LIVE dot
- Score displayed large (monospace, bold, 28px+)
- Player pair names with country flags
- Tournament name + round as subtitle
- Tapping opens match detail
- If multiple live matches: horizontal carousel of live cards

#### B. Upcoming Matches (next 24h)
- Horizontal scrollable shelf of compact match cards
- Each card: time, pair names, tournament badge
- Subtle green border on "starting soon" matches (< 1h)
- Section header: "Coming Up" with count

#### C. Tournament Spotlight
- Featured active tournament card (large, with tournament logo)
- Shows bracket progress or current round
- Quick stats: matches played, upcoming today
- CTA: "View Full Draw →"

#### D. Rankings Snapshot
- Top 5 players (men by default, toggle for women)
- Horizontal scrollable player cards with:
  - Large circular avatar (56px) with rank badge overlay
  - Player name
  - Country flag
  - Points
  - Rank movement (green arrow up, red arrow down)
- "See Full Rankings →" link

#### E. Latest Results
- Vertical list of recent finished matches (last 24h)
- Compact cards: winner highlighted (bold + green check), loser muted
- Set scores on the right
- Grouped by tournament with collapsible headers

#### F. Feed Preview (News + Highlights)
- 2-3 featured items: mix of video thumbnails and news cards
- Video cards: 16:9 thumbnail with play button overlay, duration badge
- News cards: small thumbnail left, headline right
- "See All →" link to full feed

#### G. Fantasy Teaser (placeholder for upcoming gamification)
- Muted card at bottom with lock icon
- "Fantasy Padel — Coming Soon"
- Brief teaser text
- Email capture or "Notify Me" button
- Uses orange accent color for the CTA

### 2. SCORES PAGE

Full dedicated scores view, optimized for checking results during tournaments.

**Layout:**
- Tab bar at top: **Live** | **Upcoming** | **Results**
- Gender filter: compact pill toggle (M / All / W)
- Matches grouped by tournament (collapsible)

**Tournament Group:**
```
┌─────────────────────────────────────┐
│ 🏆 FIP Gold Almaty          LIVE 🔴│
│    Gold · Apr 1-6 · Kazakhstan      │
├─────────────────────────────────────┤
│ QF · Court 1                        │
│ Lebron / Galan          6 4 [3]     │
│ Coello / Tapia          3 6 [5]  ●  │
├─────────────────────────────────────┤
│ QF · Court 2            14:30       │
│ Di Nenno / Navarro                  │
│ Stupaczuk / Lima                    │
└─────────────────────────────────────┘
```

**Match card design:**
- Left accent border: 3px, green for live, muted for scheduled, faded for finished
- Player names left-aligned, set scores right-aligned in monospace
- Current game points in larger font with live accent color
- Serving indicator (green dot) next to serving pair
- Winner: bold white text. Loser: `opacity: 0.5`
- Round + court as small badge pills above the match

### 3. MATCH DETAIL PAGE

Opens as a slide-up sheet or full page from any match card.

**Header:**
- Back arrow (top-left) → returns to previous context
- Tournament name + round as title
- Share button (top-right)

**Score Section (large, centered):**
```
┌─────────────────────────────────────┐
│         QF · Central Court          │
│                                     │
│  🇪🇸 Lebron / Galan                │
│        6    4    [3]                │
│  ─────────────────────              │
│  🇦🇷 Coello / Tapia    ●          │
│        3    6    [5]                │
│                                     │
│     SET 1  SET 2  SET 3             │
│          ◉ LIVE                     │
└─────────────────────────────────────┘
```

- Large monospace scores (32px+)
- Set headers below scores
- Player avatars if available
- Momentum chart below (point-by-point line graph)
- Tab bar: **Score** | **Stats** | **H2H**

### 4. FEED PAGE

Unified content stream — news articles + YouTube highlights.

**Layout:** Vertical feed, Instagram/TikTok-style cards

**Video Card:**
```
┌─────────────────────────────────────┐
│ ┌─────────────────────────────────┐ │
│ │                                 │ │
│ │      [VIDEO THUMBNAIL]         │ │
│ │           ▶ 12:34              │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
│ Incredible rally in QF! 🔥         │
│ PadelTV · 45K views · 2h ago       │
└─────────────────────────────────────┘
```

**News Card:**
```
┌─────────────────────────────────────┐
│ [IMG]  Lebron announces new         │
│        partner for 2026 season      │
│        PadelMagazine · 3h ago       │
└─────────────────────────────────────┘
```

- Swipe left to hide/dismiss
- Pull to refresh
- Category filter pills at top: All | News | Videos

### 5. RANKINGS PAGE (accessed from home "See Full Rankings")

- Full-screen list with sticky header
- Gender toggle (M/W) as segmented control with green active state
- Type toggle: Official / Race
- Search bar at top
- Player rows:
  - Rank # (large, with medal colors for top 3: gold, silver, bronze)
  - Avatar (40px circle)
  - Name + country flag
  - Points (right-aligned, monospace)
  - Rank change badge (▲ green / ▼ red / — gray)
- Top 3 get special treatment: slightly larger row, subtle gold/silver/bronze left border

### 6. TOURNAMENT DETAIL (accessed from tournament cards)

- Hero header with tournament logo, name, location, dates
- Progress bar showing tournament stage (R32 → R16 → QF → SF → F)
- Tabs: **Matches** | **Draw** | **Info**
- Matches tab: same format as Scores page but filtered to this tournament
- Draw tab: bracket visualization
- Info tab: prize money, venue, previous champions

### 7. PLAYER PROFILE (accessed from rankings or match detail)

- Large avatar header (80px)
- Name, country flag, ranking badge
- Stats grid: ranking, points, recent form (W/L)
- Recent matches list (last 20)
- Back navigation to previous screen

### 8. USER PROFILE (accessed from top-right avatar)

- Avatar + name + email
- Push notification toggle
- Bookmarked matches
- Bookmarked players (avatar chips)
- Fantasy profile placeholder (locked, coming soon)
- Sign out
- App version

## Visual Design System

### Cards
- Background: `#141414` on `#0A0A0A` base
- Border: 1px `rgba(255,255,255,0.06)`
- Border-radius: 12px (standard), 16px (hero cards)
- Padding: 16px
- Subtle shadow: `0 2px 8px rgba(0,0,0,0.3)`

### Typography
- **Font:** Inter or system sans-serif
- **Score numbers:** JetBrains Mono or monospace
- Sizes: 28-32px (hero scores), 20px (page titles), 14-16px (card titles), 12px (body), 10px (labels)
- Weight: 800 (titles), 700 (bold), 600 (medium), 400 (body)
- Letter spacing: 0.5px on uppercase labels

### Buttons & Interactive
- Primary CTA: Orange background (`#F5A623`), black text, rounded 10px
- Secondary: Transparent with green border, green text
- Ghost: No border, muted text, hover shows background
- Active nav item: Lime green indicator
- Pressed state: scale(0.95) with 150ms transition

### Status Indicators
- **LIVE:** Red dot (pulsing animation) + "LIVE" badge with red bg
- **Starting soon:** Green dot (solid) + countdown
- **Finished:** No dot, muted styling
- **Upcoming:** Clock icon, time in green monospace

### Animations
- Page transitions: slide-up for details, fade for tab switches
- Score changes: brief highlight flash (green/orange)
- Pull to refresh: custom logo animation
- Skeleton loading: shimmer effect on cards
- LIVE pulse: `animation: pulse 2s infinite` on red dot

### Iconography
- Style: Outlined, 2px stroke, rounded caps
- Size: 24px (navigation), 20px (in-card), 16px (inline)
- Active color: lime green
- Inactive color: `#6B7280`

## Gamification Considerations (Future-Proof)

The design should accommodate future Fantasy Padel features:
- Space for a "Fantasy" section on the home page (currently a teaser card)
- Potential addition of a Fantasy tab in bottom nav (making it 4 items: Scores, Home, Feed, Fantasy)
- Player cards that could show fantasy points alongside real stats
- Achievement/badge system in user profile
- Leaderboard view (similar structure to rankings)

Design the profile page and player cards with extensibility in mind — leave room for fantasy scores, badges, and gamification elements.

## Mobile Constraints

- Max width: 430px (iPhone 15 Pro Max viewport)
- Bottom nav height: 56px + safe area
- Header height: 48px + safe area
- Touch targets: minimum 44x44px
- Scrollable areas: momentum scrolling (`-webkit-overflow-scrolling: touch`)
- Safe area insets: respect `env(safe-area-inset-*)` for notch/home indicator

## Current App Reference

The current app is live at **padel-nacho.vercel.app** — you can reference it for data structure and content patterns, but the visual design should be completely fresh based on this brief.

### Current pages to redesign:
1. `/v2` — Home (currently 5-tab layout, tournament-grouped matches)
2. `/v2/matches` — Scores (tournament-grouped with Live/All/Results tabs)
3. `/match/[id]` — Match detail (score + momentum chart + H2H)
4. `/v2/ranking` — Rankings (Official/Race tabs, gender toggle)
5. `/v2/tournaments` — Tournament browser (Premier Padel / FIP tabs)
6. `/v2/tournaments/[id]` — Tournament detail
7. `/v2/feed` — News + videos feed
8. `/v2/profile` — User profile with bookmarks
9. Bottom navigation — Currently 5 tabs, redesign to 3 (Scores, Home, Feed)

## Deliverables

1. **Home page** — The main hub with all sections
2. **Scores page** — Dedicated live scores view
3. **Match detail** — Individual match view
4. **Feed page** — News + videos stream
5. **Rankings view** — Full ranking list (can be a slide-up from home or standalone)
6. **Tournament detail** — Tournament-specific match view
7. **Profile page** — User settings and bookmarks
8. **Bottom navigation** — 3-item nav with green active indicator
9. **Component library** — Match cards (live/scheduled/finished), player rows, tournament cards, badges, buttons

Build this as a responsive mobile-first React app with Tailwind CSS. Dark theme only. Use the color palette defined above. Make it feel premium, fast, and fun — worthy of the PadelNachos brand.
