# PadelGenius — Design Spec

**Date:** 2026-04-11
**Route:** `/padelgenius` (inside `(app)` layout group)
**Status:** Approved for implementation

## Overview

PadelGenius is a daily padel learning mini-game inside PadelNachos. Players answer 5 visual questions per day across themed challenges to improve their understanding of padel rules, tactics, positioning, and shot selection. The game uses a 3D behind-the-player court perspective with cartoon/chibi characters and includes sponsor placement zones for future monetization.

**Core goal:** Help players evolve their padel understanding through visual, interactive learning — not just trivia.

## Architecture: Static JSON + localStorage

No new database tables. No auth requirement.

- **Questions:** Static JSON file at `src/data/genius-questions.json`
- **Progress:** localStorage via a custom `useGeniusProgress` hook
- **Court rendering:** SVG-based 3D perspective court component
- **Avatars:** Emoji + gradient color, stored in localStorage

This matches existing patterns (`useBookmarks`, `useHiddenFeedItems`, `useFeedPreferences`) and ships with zero backend work. If PadelGenius takes off, the data shape migrates cleanly to Supabase later.

## Game Modes

### 1. Court Scenario (A/B/C choice)

The primary mode. Player sees a 3D court with characters positioned in a tactical situation, ball in play, and must choose the correct response.

- **Visual:** Behind-player 3D court, cartoon characters, ball with trajectory trail
- **Interaction:** Select one of 2-3 answer options, then confirm
- **Covers:** Shot selection, tactical decisions, wall play, when to attack vs defend

### 2. Court Tap (position yourself)

Player taps directly on the court to indicate where they should position themselves.

- **Visual:** Same 3D court, but "YOU" character is missing — replaced with a "?" marker
- **Interaction:** Tap/click on the court surface. Distance from ideal zone determines score (full XP if within correct zone, partial if close, zero if far)
- **Covers:** Positioning, formation, movement after partner's shot, serve return position

### 3. Rules & Knowledge Cards

Visual flashcard-style questions with court diagrams explaining rules, scoring, and terminology.

- **Visual:** Card layout with a focused court diagram illustrating the rule scenario
- **Interaction:** Binary choice (Legal/Fault, True/False, Correct/Incorrect) or A/B/C
- **Covers:** Serve rules, let rules, wall bounce rules, scoring, court dimensions, equipment rules

## Question Data Model

```typescript
interface GeniusQuestion {
  id: number
  type: 'court-scenario' | 'court-tap' | 'rules-card'
  difficulty: 1 | 2 | 3                 // 1=beginner, 2=intermediate, 3=advanced
  theme: 'rules' | 'shots' | 'positioning' | 'communication' | 'mixed'
  question: string                      // main question text
  context?: string                      // secondary/setup text

  // Court visual data (used by CourtView component)
  court: {
    players: {
      role: 'you' | 'partner' | 'opponent1' | 'opponent2'
      x: number                         // 0-100 normalized court position
      y: number                         // 0-100 normalized court position
    }[]
    ball?: { x: number; y: number }
    trajectory?: {
      from: [number, number]
      to: [number, number]
    }
    highlights?: {
      type: 'zone' | 'arrow' | 'label'
      coords: number[]
      label?: string
      color?: string
    }[]
  }

  // Answer format — varies by type
  options?: {
    id: string                          // 'a', 'b', 'c'
    label: string                       // shot/action name
    description?: string                // short explanation
    emoji?: string                      // visual hint
  }[]
  correctOption?: string                // for court-scenario + rules-card
  correctZone?: {                       // for court-tap
    x: number
    y: number
    radius: number                      // acceptable distance (normalized)
  }

  // Post-answer explanation
  explanation: {
    title: string                       // e.g., "Why Bandeja?"
    text: string                        // 2-3 sentences
    proTip?: string                     // optional "Pro Tip" callout
    courtOverlay?: {                    // shows correct play on court
      trajectory?: {
        from: [number, number]
        to: [number, number]
      }
      wrongTrajectory?: {               // dimmed red line showing wrong option
        from: [number, number]
        to: [number, number]
        label?: string
      }
      label?: string
    }
  }

  xp: number                           // points awarded: 100 (easy), 150 (med), 200 (hard)
}
```

## Progress Data Model (localStorage)

```typescript
interface GeniusProgress {
  // Daily state
  todayDate: string                     // "2026-04-11" — resets daily
  todayAnswered: number[]               // question IDs answered today
  todayCorrect: number                  // correct count today

  // Progression
  totalXp: number
  level: number
  streak: number                        // consecutive days played
  bestStreak: number
  lastPlayedDate: string                // for streak calculation

  // History
  answeredAll: number[]                 // all-time answered question IDs
  wrongAnswers: number[]                // IDs answered incorrectly (for retry)

  // Adaptive difficulty
  currentDifficulty: 1 | 2 | 3
  recentAccuracy: number[]              // last 10 answers (1=correct, 0=wrong)

  // Avatar
  avatar: {
    icon: string                        // emoji
    color: string                       // gradient key
    name: string                        // display name
  }
}
```

**Storage key:** `pn_genius_progress`

**Hydration pattern:** Same as `useHiddenFeedItems` — start empty on SSR, hydrate in `useEffect` to avoid React mismatch.

## Daily Theme Schedule

| Day       | Theme          | Emoji | Primary Mode(s)              |
|-----------|----------------|-------|------------------------------|
| Monday    | Rules & Scoring| 📐    | Rules Cards                  |
| Tuesday   | Shot Selection | 🎯    | Court Scenario               |
| Wednesday | Positioning    | 📍    | Court Tap + Court Scenario   |
| Thursday  | Communication  | 💬    | Court Scenario               |
| Friday    | Mixed Challenge| ⚡    | All modes                    |
| Saturday  | Weekend Bonus  | 🏆    | All modes, harder, 2× XP    |
| Sunday    | Weekend Bonus  | 🏆    | All modes, harder, 2× XP    |

## Daily Question Selection Algorithm

Each day at midnight (client-side, checked on page load):

1. Determine today's theme from `new Date().getDay()`
2. Filter questions by theme (Friday/Sat/Sun = all themes)
3. Filter by difficulty: `currentDifficulty ± 1` for variety
4. Exclude questions in `answeredAll` (already seen)
5. If pool < 5: add questions from `wrongAnswers` first (retry mistakes)
6. If still < 5: recycle from oldest `answeredAll` entries
7. Shuffle and pick 5
8. Weekend bonus: prefer difficulty 2-3 questions

## Adaptive Difficulty

After every 10 answers (check `recentAccuracy.length`):
- Accuracy > 80% → bump `currentDifficulty` up (max 3)
- Accuracy < 40% → bump `currentDifficulty` down (min 1)
- Otherwise → stay

New players start at difficulty 1.

## Leveling System

| Level | XP Required | Title        |
|-------|-------------|--------------|
| 1     | 0           | Rookie       |
| 2     | 500         | Club Player  |
| 3     | 1,500       | Regular      |
| 4     | 3,000       | Tactician    |
| 5     | 5,000       | Court Reader |
| 6     | 8,000       | Strategist   |
| 7     | 12,000      | PadelGenius  |

Unlockable avatar icons at Level 5 and Level 7.

## Avatar System

### Initial Assignment
On first visit (no progress in localStorage), assign a random avatar from the starter pool:

**Starter avatars (10):**

| Name   | Icon | Color Gradient              |
|--------|------|-----------------------------|
| Ace    | 🎾   | #38C8FF → #0066aa (blue)    |
| Volley | 🏸   | #F472B6 → #cc3388 (pink)    |
| Smash  | 💪   | #7ED321 → #4a8c10 (green)   |
| Flash  | ⚡   | #FFDD00 → #cc9900 (yellow)  |
| Fuego  | 🔥   | #FF4655 → #cc2233 (red)     |
| Tactic | 🧠   | #9B59B6 → #6c3483 (purple)  |
| Nacho  | 🌶️   | #E67E22 → #a85c16 (orange)  |
| Sniper | 🎯   | #1ABC9C → #0e8c72 (teal)    |
| Ice    | 🧊   | #3498DB → #1a6aab (blue)    |
| Leon   | 🦁   | #E74C3C → #a83229 (red)     |

### Customization
Players can change their icon (emoji) and color (gradient) from the hub. The avatar name auto-updates to match the icon selection.

### Avatar on Court
The "YOU" character on the 3D court wears a jersey in the avatar's color. The chibi character style is consistent across all players — only jersey color differentiates.

## Court Rendering

### Perspective
Behind-the-player camera angle (like the reference tennis game screenshot). Player character is large in foreground (seen from behind), opponents are smaller in the far court, court recedes with perspective.

### Padel-Specific Elements
- **Glass walls** on all 4 sides (semi-transparent with frame posts)
- **Solid wall sections** at the bottom of side walls (below the glass)
- **Back walls** fully enclosed
- **Net** with posts and mesh pattern
- **Service lines** and center line
- **Court surface:** Blue (like Premier Padel) with white lines

### Character Style
Cartoon/chibi characters with:
- Oversized heads relative to body
- Simple facial features (big eyes, small mouth)
- Jersey/shirt in team color (blue for your team, red/pink for opponents)
- Padel racket held in hand
- Ground shadow underneath

Opponents face the camera (features visible). Your character and partner face away (back of head visible).

### Implementation
Pure SVG — no canvas, no WebGL, no external libraries. Court positions are normalized (0-100) and mapped to the perspective projection via simple math. The `CourtView` component takes a `court` data prop and renders all elements.

## Sponsor Placement Zones

6 zones available for future sponsorship, matching real padel court advertising:

| Zone              | Location               | Visibility | Tier     |
|-------------------|------------------------|------------|----------|
| Back Wall Banner  | Far wall, always in frame | Always   | Premium  |
| Net Band          | Across the net          | Always     | Standard |
| Side Glass L      | Left wall               | Partial    | Standard |
| Side Glass R      | Right wall              | Partial    | Standard |
| Court Floor Logo  | Center court surface    | Subtle     | Basic    |
| Explanation Card  | "Powered by" on post-answer | Per-question | Basic |

Sponsors are configured via a simple config object (not per-question). Empty by default — no sponsor UI renders until configured.

## Page Structure

Route: `src/app/(app)/padelgenius/page.tsx`

Single page component with state-driven view switching (no sub-routing):

### Views

1. **Hub View** — entry point
   - Avatar + level + streak in header
   - Today's theme card (name, description, mode breakdown)
   - "Start Daily Challenge" CTA button
   - Stats row (total questions, accuracy %, best streak)
   - Week calendar strip (Mon-Sun with completion status)

2. **Question View** — the game
   - Minimal top bar (exit, progress dots/bar, streak)
   - 3D court rendering (takes ~70% of viewport)
   - Question text + answer options at bottom
   - Confirm button

3. **Explanation View** — after answering
   - Correct/incorrect result banner with XP earned
   - 3D court with shot path overlay (green = correct, red dashed = wrong)
   - Text explanation card with optional Pro Tip
   - Sponsor "powered by" slot
   - "Next Question" button

4. **Summary View** — after all 5 questions
   - Celebration header
   - Score card (correct count, XP earned, streak)
   - Level progress bar with animation
   - Question breakdown (list of all 5 with correct/wrong indicators)
   - "Review Mistakes" and "Share Result" buttons
   - Tomorrow teaser card

### State Machine

```
hub → playing(1) → explanation(1) → playing(2) → ... → explanation(5) → summary → hub
```

Exit button during play returns to hub (progress for partial day is not saved — must complete all 5).

## Component Breakdown

```
src/app/(app)/padelgenius/
  page.tsx                    # Main page, view state machine
  components/
    HubView.tsx               # Daily hub with theme card, stats, CTA
    QuestionView.tsx          # Question display + answer selection
    ExplanationView.tsx       # Post-answer explanation
    SummaryView.tsx           # End-of-day results
    CourtView.tsx             # 3D SVG court renderer (shared across views)
    AvatarPicker.tsx          # Avatar customization panel
    WeekStrip.tsx             # Mon-Sun calendar strip

src/hooks/
  useGeniusProgress.ts        # localStorage progress hook

src/data/
  genius-questions.json       # Question bank
  genius-avatars.ts           # Avatar definitions (icons, colors, names)
  genius-levels.ts            # Level thresholds and titles
```

## Question Bank — Initial Content

Target: **50 questions** for launch (enough for ~10 days of unique content before recycling).

Distribution:
- **Rules & Scoring:** 12 questions (rules-card type)
- **Shot Selection:** 12 questions (court-scenario type)
- **Positioning:** 10 questions (court-tap + court-scenario)
- **Communication:** 8 questions (court-scenario type)
- **Mixed/General:** 8 questions (all types)

Difficulty split: ~20 easy, ~20 medium, ~10 hard.

Content sources for question creation:
- Official FIP padel rules
- Common tactical patterns (bandeja vs smash, when to lob, chiquita timing)
- Positioning fundamentals (where to stand on serve, return, after a lob)
- Communication calls (mine/yours, switch, stay)
- Wall play rules (which bounces are legal/illegal)

Questions will be authored manually (or with Claude assistance) and stored in the static JSON file. New questions can be added by editing the JSON — no deployment or migration needed beyond a code push.

## Brand & Style Alignment

PadelGenius lives inside PadelNachos — it must feel like part of the same app, not a separate product.

### Colors (from globals.css Forge Dark v2)
- **Backgrounds:** `--bg-base: #1A1A1A`, `--bg-card: #1F1F1F`, `--bg-subtle: #1E1E1E`
- **Text:** `--text-primary: #EEE4CE` (warm parchment), `--text-secondary: #9AAEC4`, `--text-muted: #6889A5`
- **Accent (active/interactive):** `--color-accent: #38C8FF` (electric sky blue)
- **Live/urgent:** `--color-live: #FF4655` (used for streak fire)
- **Success/correct:** `#7ED321` (green, used for correct answers and XP)
- **Men's:** `--color-men: #5BA8FF` — **Women's:** `--color-women: #F472B6`
- **Court surface:** Blue tones (#1976b8) matching Premier Padel courts

### Typography
- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- No custom fonts — matches the rest of the app
- Bold weights (700-800) for headings, 600 for labels, 400 for body

### UI Patterns
- Cards use `#1F1F1F` background with subtle borders (`#333`)
- No border-radius on cards (brand uses chunky clip-paths where relevant)
- Buttons: solid accent color (`#38C8FF`) with white/dark text, 12px border-radius
- Badges/pills: small rounded containers with translucent accent backgrounds
- Bottom padding: 72px (for BottomNavV3)

### Court Style
- Court colors should feel cohesive with the dark theme — no bright backgrounds that clash
- Character jersey colors use app accent colors (blue team = `#2980B9`/`#38C8FF`, opponents = `#E74C3C`/`#F472B6`)
- Sponsor zones use subtle translucent backgrounds — never visually dominant

### What NOT to do
- No light mode (the app is dark-only currently)
- No custom fonts or icon libraries beyond system + emoji
- No external animation libraries — use CSS transitions + SVG animations
- No gamification UI that feels disconnected from the sports/data aesthetic of the rest of the app

## Animations

Follow existing app patterns from `CLAUDE.md`:
- **Bar/progress animations:** 700ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`, stagger with `rowIndex * 80ms`
- **Result reveal:** Scale + fade entrance for correct/incorrect banner
- **XP counter:** Animated count-up on summary screen
- **Court shot path:** SVG path animation (stroke-dasharray) on explanation view
- **Ball trajectory:** Dotted trail with opacity fade
- **Respect `prefers-reduced-motion`:** Skip animations, show final state immediately

## Entry Points

1. **Direct URL:** `/padelgenius`
2. **Existing teaser:** `PadelGeniusTeaser.tsx` component already exists — update to link to the new page
3. **Future:** Add to BottomNav or home page as a promoted feature

## Out of Scope (Future)

- Supabase sync / cross-device progress
- Global leaderboard
- Auth requirement
- Head-to-head multiplayer
- Actual sprite/image assets (MVP uses SVG chibi)
- Sound effects
- Buffer/sharing integration for results
- Premium/paid unlock for unlimited questions
