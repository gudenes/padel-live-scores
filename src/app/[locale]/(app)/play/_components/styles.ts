// src/app/[locale]/(app)/play/_components/styles.ts
//
// The Play screens' CSS, ported from public/mockup-play-market.html.
//
// Why a <style> block rather than inline styles (the house default): the
// design leans on things inline styles cannot express — ::after gradients on
// the hero, keyframes for the tick and the drag stamps, :active on the swipe
// deck, and the reduced-motion media query. BottomNavV3 already sets this
// precedent with NAV_STYLES.
//
// Every class is prefixed `pl-`. The mockup's names (.tag, .q, .sub, .pos,
// .act, .odd) are far too generic to put in a global stylesheet.
//
// Colours come from the tokens already in globals.css (--lime*, --no*,
// --clip-*, Forge Dark v2). Nothing is redefined here.

export const PLAY_STYLES = `
.pl-market-group { flex:none; min-width:0; }
/* ── Frame ─────────────────────────────────────────────────────── */
.pl-root {
  max-width: 500px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  /* BottomNavV3's real height: 4px padding-top + 63px of icon/label +
     its own bottom padding. NOT the 72px (app)/layout.tsx reserves as
     body padding — that number is 11px short, which every other page
     gets away with because they scroll and Play does not. Measured, not
     guessed: nav rect was 729→812 on a 812px viewport. */
  /* The card's two-colour language, after the Padel Labs match-recap reel:
     one pair orange, the other lime, on black.

     ORANGE is #FF6B2B — NOT a new colour. It is already the app's pair-one /
     streak / upset orange (MomentumChart, MatchStatsBar, every
     components/prediction/* bar, lib/badges). It lives here rather than in
     globals.css because globals has never had an orange token and every other
     surface hardcodes the literal; scoping it to .pl-root is the smallest
     change that cannot affect a page outside Play.

     The skirt is the pressed-button underside, darkened on the same ratio
     --lime-skirt (#558D14) sits below --lime (#7ED321): about x0.68. */
  --pl-orange:        #FF6B2B;
  --pl-orange-skirt:  #AD481D;
  --pl-orange-bg:     rgba(255, 107, 43, 0.10);
  --pl-orange-border: rgba(255, 107, 43, 0.32);

  --pl-navh: calc(67px + max(env(safe-area-inset-bottom, 16px), 16px));
  /* Header (62) + sub-nav (50) + nav, plus the iOS safe-area inset the
     body already carries. What's left is the deck's playfield. */
  --pl-chrome: calc(62px + 50px + var(--pl-navh) + env(safe-area-inset-top, 0px));
}
/* Trade sheet and confirmation hide the sub-nav and take the whole frame;
   give those 50px back to the screens so nothing is cropped. */
.pl-root.pl-nosub { --pl-chrome: calc(62px + var(--pl-navh) + env(safe-area-inset-top, 0px)); }
.pl-screens {
  position: relative;
  height: calc(100dvh - var(--pl-chrome));
  min-height: 460px;
  overflow: hidden;
}
.pl-screen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  opacity: 0;
  pointer-events: none;
  transition: opacity .22s ease;
}
.pl-screen.pl-on { opacity: 1; pointer-events: auto; }

/* ── Sub-nav ───────────────────────────────────────────────────── */
.pl-subnav {
  flex: none;
  height: 50px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-base);
}
.pl-subnav button {
  flex: 1;
  background: var(--bg-subtle);
  border: 1px solid var(--border-base);
  color: var(--text-muted);
  font-family: inherit;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .7px;
  text-transform: uppercase;
  padding: 8px 0;
  cursor: pointer;
  clip-path: var(--clip-tag);
  position: relative;
  transition: background .12s, color .12s;
}
.pl-subnav button.pl-on { background: var(--lime); border-color: var(--lime); color: #0a0a0a; }
/* Sits INSIDE the button — the parent's clip-path clips its children, so a
   negatively-offset badge would be sliced off at the tilted edge. */
.pl-subnav button .pl-badge {
  position: absolute; top: 4px; right: 5px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--color-live);
}
/* Balance doubles as the route into your positions — tapping your money to
   see your money is the obvious gesture, and it buys back a tab slot. */
.pl-subnav button.pl-balchip {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 10px;
  background: var(--bg-card); border-color: var(--border-card); color: var(--text-primary);
  font-size: 12px; font-variant-numeric: tabular-nums; letter-spacing: 0; text-transform: none;
}
.pl-subnav button.pl-balchip.pl-on { background: var(--lime); border-color: var(--lime); color: #0a0a0a; }
.pl-subnav button.pl-balchip.pl-on .pl-coin { background: #0a0a0a; color: var(--lime); box-shadow: none; }

.pl-guacas {
  display: inline-flex; align-items: center; gap: 7px;
  background: var(--bg-card); border: 1px solid var(--border-card);
  padding: 5px 11px 5px 6px; clip-path: var(--clip-tag);
  font-weight: 900; font-size: 12.5px; font-variant-numeric: tabular-nums;
}
.pl-coin {
  width: 17px; height: 17px; border-radius: 50%; background: var(--lime); color: #0a0a0a;
  display: grid; place-items: center; font-size: 10px; font-weight: 900; flex: none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35);
}

/* ── Market deck ───────────────────────────────────────────────────
   The deck never scrolls: .pl-screens is a fixed 100dvh-minus-chrome box
   with overflow:hidden, and everything below is sized to fit inside it. The
   card is absolutely positioned against that box rather than laid out by its
   own content, so a long question cannot push the YES/NO blocks off-screen —
   .pl-mbody clips instead, and .pl-odds is pinned to the bottom by its
   margin-top:auto. */
.pl-deck-wrap { flex: 1; min-height: 0; position: relative; padding: 14px 14px 0; }
/* --pl-peek is the strip of the NEXT market left showing below the current
   card. The card is inset by exactly that much, so the peek is reserved
   space and never overlaps anything the top card needs. PEEK_GAP_PX (10) in
   DeckScreen.tsx is spent on the seam, leaving 34px of actual card. */
.pl-deck { position: absolute; inset: 14px 14px 0; perspective: 1200px; --pl-peek: 44px; }
.pl-mcard {
  position: absolute; inset: 0 0 var(--pl-peek);
  background: var(--bg-card); border: 1px solid var(--border-card);
  clip-path: var(--clip-card); overflow: hidden;
  display: flex; flex-direction: column;
  /* Top-centre, so the peek card's scale shrinks it downward from a fixed top
     edge — the visible strip stays exactly where the geometry above puts it.
     (The old 50% 120% served a rotation that the removed horizontal drag
     owned; nothing rotates any more.) */
  will-change: transform; transform-origin: 50% 0;
  /* none, not pan-y: the vertical drag IS the gesture now, and pan-y would
     hand it to the browser's scroller and fire pointercancel mid-drag. */
  user-select: none; touch-action: none;
}
.pl-mcard.pl-behind { pointer-events: none; }
/* Snap-back after an uncommitted drag — springy, because the card is coming
   back to where it started and the overshoot reads as elastic. */
.pl-mcard.pl-anim { transition: transform .32s cubic-bezier(.34,1.3,.64,1), opacity .32s ease; }
/* Committed move to another market — no spring, it is leaving. Duration must
   stay in step with NAV_MS in DeckScreen.tsx; the deck remounts when it
   elapses and a remount mid-transition snaps. */
.pl-mcard.pl-nav { transition: transform .24s cubic-bezier(.22,.61,.36,1), opacity .24s ease; }
/* .pl-tint-yes / .pl-tint-no are gone with the horizontal drag that painted
   them: they were live feedback for a gesture that no longer exists, and the
   YES/NO stamp is the whole of the commit feedback now. */

/* Hero — procedural art; we have no player photography.
   186px, not the original 168: the four faces went from 46px to 66px and the
   .pl-vs padding box below has to hold 66 + 6 gap + 26 of name/flag/rank = 98px
   between a 32px top inset (clear of .pl-chips) and a 40px bottom one (clear of
   the ::after fade the question sits on). 168 left exactly 0px of slack. */
.pl-hero { position: relative; height: 186px; flex: none; overflow: hidden; background: #0d1410; }
.pl-hero svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.pl-hero .pl-mono {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 16px;
  font-size: 72px; font-weight: 900; letter-spacing: -4px; color: rgba(255,255,255,.055);
  text-shadow: 0 2px 40px rgba(0,0,0,.6);
}
.pl-hero .pl-mono i { font-style: normal; }
/* Neutral, not lime. Season- and tournament-horizon markets have no two pairs
   to colour, so the monogram stays a ghosted white placeholder — a lime "vs"
   here would assert a side that this card does not have. */
.pl-hero .pl-mono s { text-decoration: none; font-size: 30px; color: rgba(255,255,255,.22); letter-spacing: 0; }

/* Identity — four faces, 2 v 2, over the court art. Sits under ::after's
   bottom fade (z-index 2 beats the gradient's stacking position but the
   fade still darkens the lower third, which is what keeps the question
   legible where the block overlaps the body). */
.pl-vs {
  position: absolute; inset: 0; z-index: 2;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 32px 9px 40px;
}
/* --pl-side is the pair's brand colour, set once here and read by everything
   inside: the avatar ring and the surname. The default is neutral white, so a
   pair rendered without an accent (or by a surface that has no subject to
   point at) degrades to the pre-colour look instead of inheriting a side. */
.pl-pair {
  display: flex; align-items: flex-start; justify-content: center; gap: 6px; flex: 1; min-width: 0;
  --pl-side: rgba(255,255,255,.55);
}
/* The pair the question NAMES — the one a YES is a bet on. */
.pl-pair.pl-subject { --pl-side: var(--pl-orange); }
.pl-pair.pl-other   { --pl-side: var(--lime); }
.pl-vs-sep {
  flex: none; font-size: 12px; font-weight: 900; letter-spacing: .5px; text-transform: uppercase;
  color: rgba(255,255,255,.60); text-shadow: 0 1px 8px rgba(0,0,0,.85);
}
/* The cap is deliberately WIDER than a chip can actually get at 375px — the
   pair is flex:1 and the two chips shrink to fill it, so the cap only bites on
   a wide viewport. The chips cannot shrink below the face's own 66px (a
   definite width is the flex item's automatic minimum), and the width budget
   at 375 leaves ~70px each, so they never collide. */
.pl-pchip { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; max-width: 78px; }
.pl-face {
  width: 66px; height: 66px; flex: none; border-radius: 50%; overflow: hidden;
  background: #16161a; object-fit: cover; object-position: center top;
  /* The ring is the pair's colour. 2px rather than the old 1.5px: at 66px the
     hairline read as a rendering artefact instead of a deliberate accent. */
  box-shadow: 0 0 0 2px var(--pl-side, rgba(255,255,255,.16)), 0 4px 14px rgba(0,0,0,.55);
  position: relative;
}
/* Below 360px the 66px faces stop fitting two-per-pair (320px viewport leaves
   57px a chip), and a flex item cannot shrink under its own definite width —
   they would overlap rather than ellipsise. Step down instead. */
@media (max-width: 359px) {
  .pl-face { width: 54px; height: 54px; }
  .pl-pchip { max-width: 66px; }
}
/* The .pl-hero svg rule above absolutely positions and stretches EVERY svg in
   the hero — written when the only one was the court art. A GeneratedAvatar
   fallback is an svg too, and it was being pinned to the hero's own box and
   blown up to 343x168, escaping .pl-face's overflow:hidden because its
   containing block was .pl-vs, not the clipped parent. Beaten on specificity
   rather than by loosening the original rule, which the court art still needs.
   (No backticks in this file: the whole stylesheet is one template literal.) */
.pl-hero .pl-face svg, .pl-face svg {
  position: static; inset: auto; display: block; width: 100%; height: 100%;
}
.pl-pmeta { display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 100%; }
/* The name carries the accent too, so the pairing is legible without having
   to compare two thin rings. The heavy shadow below is what keeps a saturated
   orange or lime readable over the court art. */
.pl-pname {
  font-size: 11px; font-weight: 900; letter-spacing: -.1px; line-height: 1.15;
  color: var(--pl-side, #fff);
  text-shadow: 0 1px 6px rgba(0,0,0,.9);
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pl-pline {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 9px; font-weight: 800; color: rgba(255,255,255,.72);
  text-shadow: 0 1px 6px rgba(0,0,0,.9); font-variant-numeric: tabular-nums;
}
.pl-pline i { font-style: normal; }
.pl-hero::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(10,10,10,.05) 0%, rgba(10,10,10,.35) 46%, var(--bg-card) 99%);
}
.pl-hero .pl-chips {
  position: absolute; top: 12px; left: 12px; right: 12px; z-index: 3;
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
}

.pl-tag {
  font-size: 9px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase;
  padding: 4px 8px; clip-path: var(--clip-tag);
}
.pl-tag.pl-live { background: var(--color-live); color: #fff; }
.pl-tag.pl-horizon { background: rgba(10,10,10,.72); color: var(--text-secondary); border: 1px solid var(--border-strong); }
.pl-tag.pl-horizon.pl-season { color: var(--color-accent); border-color: var(--color-accent-border); }
.pl-tag.pl-horizon.pl-tourn { color: var(--color-women); border-color: rgba(244,114,182,.30); }
.pl-tag.pl-ctx { background: rgba(10,10,10,.72); color: var(--text-muted); border: 1px solid var(--border-base); }
.pl-dot {
  width: 5px; height: 5px; border-radius: 50%; background: #fff; display: inline-block;
  margin-right: 5px; vertical-align: 1px; animation: pl-blink 1.4s infinite;
}
@keyframes pl-blink { 0%,100% { opacity: 1 } 50% { opacity: .25 } }

.pl-mbody {
  flex: 1; min-height: 0; overflow: hidden; padding: 2px 17px 12px;
  display: flex; flex-direction: column; position: relative; z-index: 2; margin-top: -34px;
}
.pl-q { font-size: 21px; font-weight: 900; line-height: 1.16; letter-spacing: -.5px; margin: 0 0 8px; }
.pl-sub { font-size: 11.5px; color: var(--text-secondary); line-height: 1.5; margin: 0; }
.pl-sub b { color: var(--text-primary); font-weight: 800; }
.pl-state {
  margin-top: 9px; font-size: 10px; font-weight: 900; letter-spacing: 1.1px;
  text-transform: uppercase; color: var(--text-muted);
}

/* Recent form — ONE line, the most decisive record among the four players.
   Sits next to the affordance that opens the fuller picture. */
.pl-form {
  margin-top: 9px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.pl-formline {
  font-size: 11px; font-weight: 800; color: var(--text-secondary); line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pl-more {
  flex: none; background: var(--bg-subtle); border: 1px solid var(--border-base);
  color: var(--text-muted); font-family: inherit; font-size: 9px; font-weight: 900;
  letter-spacing: .9px; text-transform: uppercase; padding: 5px 9px; cursor: pointer;
  clip-path: var(--clip-tag);
}

/* Price history — solid = crowd, dashed = our Elo. The gap is the story. */
.pl-spark { margin-top: 15px; }
.pl-spark .pl-lg {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;
  font-size: 8.5px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; color: var(--text-faint);
}
.pl-spark .pl-lg .pl-k2 { display: inline-flex; align-items: center; gap: 6px; }
.pl-spark .pl-lg i { width: 13px; border-top: 2px solid var(--lime); display: inline-block; }
.pl-spark .pl-lg i.pl-dash { border-top: 2px dashed var(--color-accent); }
.pl-spark svg { display: block; width: 100%; height: 46px; overflow: visible; }

/* YES / NO price blocks.
   YES is a bet ON the subject pair, so it wears the subject pair's ORANGE;
   NO is a bet on the other pair and wears their LIME. This replaces the old
   lime-YES / red-NO mapping: red is a match state (--color-live, the LIVE
   pill) and using it for a side made "No" read as an error rather than a
   position, while a lime YES claimed the colour the other pair now owns.
   Both sides are equally valid bets, so neither gets the alarm colour. */
.pl-odds { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: auto; }
.pl-odd { padding: 11px 10px 10px; text-align: center; clip-path: var(--clip-tag); border: 1px solid; }
.pl-odd .pl-lbl { font-size: 9.5px; font-weight: 900; letter-spacing: 1.4px; text-transform: uppercase; }
.pl-odd .pl-pct { font-size: 25px; font-weight: 900; line-height: 1.12; font-variant-numeric: tabular-nums; }
.pl-odd.pl-yes { background: var(--pl-orange-bg); border-color: var(--pl-orange-border); }
.pl-odd.pl-yes .pl-lbl, .pl-odd.pl-yes .pl-pct { color: var(--pl-orange); }
.pl-odd.pl-no { background: var(--lime-bg); border-color: var(--lime-border); }
.pl-odd.pl-no .pl-lbl, .pl-odd.pl-no .pl-pct { color: var(--lime); }

/* Model line — our Elo, the thing nobody else has */
.pl-model {
  margin-top: 9px; display: flex; align-items: center; justify-content: center; gap: 7px;
  font-size: 10px; font-weight: 800; letter-spacing: .5px; color: var(--text-muted);
}
.pl-model .pl-ai {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--color-accent-bg); border: 1px solid var(--color-accent-border); color: var(--color-accent);
  padding: 3px 7px; clip-path: var(--clip-tag); font-size: 9px; font-weight: 900; letter-spacing: .9px;
}

/* Drag stamps */
.pl-stamp {
  position: absolute; top: 44px; font-size: 37px; font-weight: 900; letter-spacing: 2px;
  padding: 7px 20px; border: 4px solid; opacity: 0; pointer-events: none; z-index: 6;
  clip-path: var(--clip-chunky); text-transform: uppercase;
}
.pl-stamp.pl-s-yes { left: 20px; transform: rotate(-13deg); color: var(--pl-orange); border-color: var(--pl-orange); background: var(--pl-orange-bg); }
.pl-stamp.pl-s-no  { right: 20px; transform: rotate(13deg);  color: var(--lime);      border-color: var(--lime);      background: var(--lime-bg); }

/* Deck actions.
   Both buttons are authored as intent-neutral and repainted here. The stock
   intents cannot express this pairing: intent-primary is lime (which is now
   the NO side's colour) and intent-live is the alarm red reserved for match
   state. Three classes deep so these beat .intent-neutral .pn-press-face on
   specificity rather than on stylesheet order. */
.pl-actions { flex: none; padding: 11px 22px 4px; display: flex; align-items: center; justify-content: center; gap: 26px; }
.pl-actions .pl-btn-yes .pn-press-face  { background: var(--pl-orange); color: #0a0a0a; }
.pl-actions .pl-btn-yes .pn-press-skirt { background: var(--pl-orange-skirt); }
.pl-actions .pl-btn-no  .pn-press-face  { background: var(--lime); color: #0a0a0a; }
.pl-actions .pl-btn-no  .pn-press-skirt { background: var(--lime-skirt); }
.pl-swipe-hint {
  flex: none; text-align: center; padding-bottom: 8px;
  font-size: 9px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-faint);
}

/* Short viewports (iPhone SE / 8 at 375x667, and any phone in split view).
   The deck gets 584px of .pl-screens there against 729px on a 812px phone —
   145px less — and .pl-mbody clips rather than scrolls, so the YES/NO blocks
   would be the thing cut off. Everything below buys that 145px back:

     hero       186 -> 162   (the .pl-vs box still clears 66px faces + names)
     peek        44 ->  34
     question    21 ->  18px
     sparkline   46 ->  36px
     YES/NO pct  25 ->  21px
     actions padding 11/4 -> 7/2

   Measured against the worst realistic case, a three-line question: ~284px
   of body content into ~317px of body. The round buttons keep their 58px
   target — a short screen is not a reason to make the only commit
   affordance harder to hit. */
@media (max-height: 740px) {
  .pl-deck { --pl-peek: 34px; }
  .pl-hero { height: 162px; }
  .pl-vs { padding: 22px 9px 32px; }
  .pl-q { font-size: 18px; }
  .pl-spark { margin-top: 10px; }
  .pl-spark svg { height: 36px; }
  .pl-odd .pl-pct { font-size: 21px; }
  .pl-actions { padding: 7px 22px 2px; }
}

/* Below 620px of viewport — a first-generation SE, or any phone in a small
   split view. Under the 375x667 floor this work targets, but .pl-mbody clips
   rather than scrolls, so without this the YES/NO blocks are the thing that
   disappears. (It clipped here before the peek strip existed too; this is the
   pre-existing squeeze, not a new one, but the strip made it worse.)

   The peek shrinks to a sliver rather than vanishing: there is no room to
   promise another card when the current one barely fits, but a hard edge at
   the bottom reads as "this is the only one", which is a lie. 24px less the
   10px seam leaves 14px of card — thin, but unmistakably a second card. */
@media (max-height: 620px) {
  .pl-deck { --pl-peek: 24px; }
  .pl-hero { height: 132px; }
  /* The faces step down with the hero — 66px no longer clears the padding
     box, and a clipped face is worse than a smaller one. */
  .pl-face { width: 54px; height: 54px; }
  .pl-vs { padding: 14px 9px 22px; }
  .pl-q { font-size: 16px; }
  .pl-state { margin-top: 6px; }
  .pl-form { margin-top: 6px; }
  .pl-spark { margin-top: 7px; }
  .pl-spark svg { height: 28px; }
  .pl-odd { padding: 8px 10px 7px; }
  .pl-odd .pl-pct { font-size: 19px; }
  .pl-model { margin-top: 6px; }
  .pl-mbody { padding-bottom: 8px; }
}

/* ── Trade sheet ───────────────────────────────────────────────── */
.pl-sheet {
  position: absolute; inset: 0; background: rgba(6,6,6,.80);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  display: flex; flex-direction: column; justify-content: flex-end; z-index: 20;
}
.pl-sheet-panel {
  background: var(--bg-card); border-top: 1px solid var(--border-card);
  padding: 18px 18px 22px; clip-path: polygon(0% 2%, 100% 0%, 100% 100%, 0% 100%);
  max-height: 100%; overflow-y: auto;
}
.pl-sheet-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.pl-sheet-head h3 { margin: 0; font-size: 19px; font-weight: 900; letter-spacing: -.3px; }
.pl-sheet-head p { margin: 5px 0 0; font-size: 11.5px; color: var(--text-secondary); line-height: 1.45; }
.pl-x { background: none; border: 0; color: var(--text-muted); font-size: 21px; cursor: pointer; line-height: 1; padding: 2px 4px; font-family: inherit; }

.pl-price-row { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: stretch; margin-bottom: 15px; }
.pl-side-block { padding: 11px 16px; text-align: center; clip-path: var(--clip-tag); border: 1px solid; min-width: 104px; }
.pl-side-block .pl-lbl { font-size: 9.5px; font-weight: 900; letter-spacing: 1.4px; text-transform: uppercase; }
.pl-side-block .pl-pct { font-size: 25px; font-weight: 900; line-height: 1.15; font-variant-numeric: tabular-nums; }
.pl-side-block.pl-yes { background: var(--lime-bg); border-color: var(--lime-border); }
.pl-side-block.pl-yes .pl-lbl, .pl-side-block.pl-yes .pl-pct { color: var(--lime); }
.pl-side-block.pl-no { background: var(--no-bg); border-color: var(--no-border); }
.pl-side-block.pl-no .pl-lbl, .pl-side-block.pl-no .pl-pct { color: var(--no); }
.pl-pps {
  background: var(--bg-subtle); border: 1px solid var(--border-base); clip-path: var(--clip-tag);
  display: flex; flex-direction: column; justify-content: center; padding: 10px 14px;
}
.pl-pps .pl-k { font-size: 9.5px; font-weight: 900; letter-spacing: 1.2px; color: var(--text-muted); text-transform: uppercase; }
.pl-pps .pl-v { font-size: 22px; font-weight: 900; font-variant-numeric: tabular-nums; margin-top: 2px; }

.pl-amounts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
.pl-amt {
  background: var(--bg-subtle); border: 1px solid var(--border-base); color: var(--text-secondary);
  font-family: inherit; font-size: 13px; font-weight: 900; padding: 11px 0; cursor: pointer;
  clip-path: var(--clip-tag); font-variant-numeric: tabular-nums;
  transition: background .12s, color .12s, border-color .12s;
}
.pl-amt.pl-on { background: var(--lime); border-color: var(--lime); color: #0a0a0a; }
.pl-amt:disabled { opacity: .35; cursor: not-allowed; }
.pl-shares { text-align: center; font-size: 11.5px; font-weight: 800; color: var(--text-muted); margin-bottom: 15px; font-variant-numeric: tabular-nums; }
.pl-shares b { color: var(--text-primary); }

.pl-bal {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--bg-subtle); border: 1px solid var(--border-base);
  padding: 11px 14px; clip-path: var(--clip-tag); margin-bottom: 15px;
}
.pl-bal .pl-k { font-size: 9.5px; font-weight: 900; letter-spacing: 1.2px; color: var(--text-muted); text-transform: uppercase; }
.pl-note {
  display: flex; gap: 9px; align-items: flex-start; margin-top: 13px;
  background: var(--bg-subtle); border: 1px solid var(--border-base);
  padding: 10px 12px; font-size: 10.5px; line-height: 1.5; color: var(--text-muted);
}
.pl-note svg { width: 14px; height: 14px; flex: none; margin-top: 1px; fill: var(--text-dim); }
.pl-note.pl-err { border-color: var(--no-border); background: var(--no-bg); color: var(--no); }
.pl-note.pl-err svg { fill: var(--no); }

/* ── Market detail sheet ───────────────────────────────────────────
   Reuses the trade sheet's shell (.pl-sheet / .pl-sheet-panel) so the two
   overlays share one shape, one backdrop and one close affordance. */
.pl-detail { max-height: 92%; }
.pl-dpairs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 4px; }
.pl-dpair {
  background: var(--bg-subtle); border: 1px solid var(--border-base);
  clip-path: var(--clip-card); padding: 10px 9px 11px; min-width: 0;
}
.pl-dpair-head { text-align: center; margin-bottom: 9px; }
.pl-dside {
  font-size: 10px; font-weight: 900; letter-spacing: .6px; line-height: 1.3;
  display: block; overflow: hidden; text-overflow: ellipsis;
}
/* Keyed on subject/other, not on slot order — the sheet opens from the card
   and has to wear the same colour on the same pair. */
.pl-dside.pl-subject { color: var(--pl-orange); }
.pl-dside.pl-other   { color: var(--lime); }
/* The avatar strip inside the sheet is on an opaque panel, not the court art,
   so it drops the heavy text-shadow the hero needs — and the surname reverts
   to plain text, because the pair heading right above it already carries the
   colour and two coloured lines in a row is noise. */
.pl-dpair .pl-pname { color: var(--text-primary); text-shadow: none; }
.pl-dpair .pl-pline { color: var(--text-muted); text-shadow: none; }
.pl-dpair .pl-face { width: 40px; height: 40px; box-shadow: 0 0 0 1.5px var(--pl-side, rgba(255,255,255,.12)); }
.pl-dplayer { margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--border-base); }
.pl-dname { font-size: 11.5px; font-weight: 900; line-height: 1.3; }
.pl-dstats {
  margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px 8px;
  font-size: 10px; font-weight: 800; color: var(--text-muted); font-variant-numeric: tabular-nums;
}
.pl-dstats.pl-dnone { font-weight: 700; color: var(--text-faint); font-style: italic; }
.pl-dform {
  margin-top: 5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 9.5px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; color: var(--text-dim);
}
.pl-dstreak { display: inline-flex; gap: 3px; }
.pl-dstreak i {
  font-style: normal; width: 14px; height: 14px; display: grid; place-items: center;
  font-size: 8.5px; font-weight: 900; clip-path: var(--clip-tag);
}
.pl-dstreak i.pl-w { background: var(--lime-bg); border: 1px solid var(--lime-border); color: var(--lime); }
.pl-dstreak i.pl-l { background: var(--no-bg); border: 1px solid var(--no-border); color: var(--no); }

.pl-dsec { margin-top: 14px; }
.pl-dk {
  font-size: 9.5px; font-weight: 900; letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 7px;
}
.pl-dempty { margin: 0; font-size: 12px; font-weight: 700; color: var(--text-dim); line-height: 1.5; }
.pl-dh2h {
  display: flex; align-items: center; justify-content: center; gap: 14px;
  background: var(--bg-subtle); border: 1px solid var(--border-base);
  clip-path: var(--clip-tag); padding: 11px 12px;
}
.pl-dh2h-side { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; flex: 1; }
.pl-dh2h-side b { font-size: 22px; font-weight: 900; font-variant-numeric: tabular-nums; }
.pl-dh2h-side em {
  font-style: normal; font-size: 9.5px; font-weight: 800; color: var(--text-dim);
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pl-dh2h-dash { flex: none; font-size: 15px; font-weight: 900; color: var(--text-faint); }
.pl-dsplit { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.pl-dsplit > div {
  background: var(--bg-subtle); border: 1px solid var(--border-base);
  clip-path: var(--clip-tag); padding: 10px 12px;
  display: flex; flex-direction: column; gap: 3px;
}
.pl-dsplit span {
  font-size: 9px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted);
}
.pl-dsplit b { font-size: 21px; font-weight: 900; font-variant-numeric: tabular-nums; color: var(--lime); }
.pl-dsplit b.pl-dmodel { color: var(--color-accent); }
/* A historical base rate, NOT a model prediction — see baselineProb in
   src/app/api/play/_shared.ts. Deliberately not the accent blue the model
   wears: neutral text colour, smaller, lowercase, and a dashed rule under it,
   which is the visual language of an estimate rather than a forecast. If this
   ever reads as confident as .pl-dmodel, the honesty of the chip is gone. */
.pl-dsplit b.pl-dbaseline {
  color: var(--text-secondary); font-size: 16px; font-weight: 800;
  text-transform: lowercase; letter-spacing: .2px;
  align-self: flex-start; padding-bottom: 2px;
  border-bottom: 1px dashed var(--border-base);
}
.pl-dnote { margin: 8px 0 0; font-size: 10px; line-height: 1.55; color: var(--text-faint); }

/* ── Confirmation ──────────────────────────────────────────────── */
.pl-confirm { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 18px 14px; position: relative; overflow: hidden; }
.pl-confirm-art { position: relative; height: 172px; flex: none; margin: 0 -18px; overflow: hidden; background: #0d1410; }
.pl-confirm-art svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.pl-confirm-art::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,10,10,.1), var(--bg-base) 96%); }
.pl-tick {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  width: 74px; height: 74px; border-radius: 50%; background: var(--lime);
  display: grid; place-items: center; z-index: 3;
  box-shadow: 0 0 0 9px rgba(126,211,33,.13), 0 10px 30px rgba(0,0,0,.6);
  animation: pl-pop .42s cubic-bezier(.34,1.56,.64,1);
}
@keyframes pl-pop {
  0% { transform: translate(-50%,-50%) scale(.3); opacity: 0 }
  100% { transform: translate(-50%,-50%) scale(1); opacity: 1 }
}
.pl-tick svg { position: static; width: 36px; height: 36px; stroke: #0a0a0a; stroke-width: 3.4; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.pl-confirm h3 { margin: 16px 0 0; text-align: center; font-size: 22px; font-weight: 900; letter-spacing: -.3px; }
.pl-confirm .pl-deal { margin: 9px 0 0; text-align: center; font-size: 13.5px; color: var(--text-secondary); line-height: 1.6; }
.pl-confirm .pl-deal b { color: var(--text-primary); font-weight: 900; }
.pl-confirm .pl-deal .pl-sideY { color: var(--lime); font-weight: 900; }
.pl-confirm .pl-deal .pl-sideN { color: var(--no); font-weight: 900; }
.pl-confirm .pl-approx { margin: 4px 0 0; text-align: center; font-size: 11px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.pl-confirm-cta { margin-top: 18px; display: flex; flex-direction: column; gap: 9px; }
.pl-upnext { margin-top: auto; border-top: 1px solid var(--border-base); padding-top: 13px; }
.pl-upnext .pl-k { font-size: 9.5px; font-weight: 900; letter-spacing: 1.3px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 9px; }
.pl-upnext-card {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  background: var(--bg-card); border: 1px solid var(--border-card);
  padding: 11px 13px; clip-path: var(--clip-card); cursor: pointer; font-family: inherit; color: inherit;
}
.pl-upnext-card .pl-thumb { width: 46px; height: 46px; flex: none; position: relative; overflow: hidden; background: #0d1410; clip-path: var(--clip-tag); }
.pl-upnext-card .pl-thumb svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.pl-upnext-card .pl-t { flex: 1; min-width: 0; }
.pl-upnext-card .pl-t .pl-h { font-size: 8.5px; font-weight: 900; letter-spacing: 1px; color: var(--color-women); text-transform: uppercase; }
.pl-upnext-card .pl-t .pl-q2 { font-size: 12.5px; font-weight: 800; line-height: 1.35; margin-top: 3px; }
.pl-upnext-card .pl-t .pl-m { font-size: 10px; color: var(--text-dim); margin-top: 3px; }
.pl-upnext-card .pl-go { color: var(--text-muted); font-size: 17px; font-weight: 900; }

/* ── Positions ─────────────────────────────────────────────────── */
.pl-pos-head { flex: none; padding: 14px 16px 0; display: flex; align-items: center; justify-content: space-between; }
.pl-pos-head h2 { margin: 0; font-size: 20px; font-weight: 900; letter-spacing: -.3px; }
.pl-seg { flex: none; display: flex; gap: 6px; padding: 13px 16px 12px; }
.pl-seg button {
  flex: 1; background: var(--bg-subtle); border: 1px solid var(--border-base); color: var(--text-muted);
  font-family: inherit; font-size: 10.5px; font-weight: 900; letter-spacing: .7px; text-transform: uppercase;
  padding: 9px 0; cursor: pointer; clip-path: var(--clip-tag);
}
.pl-seg button.pl-on { background: var(--lime); border-color: var(--lime); color: #0a0a0a; }
.pl-pos-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 10px; }
.pl-pos { display: flex; gap: 12px; background: var(--bg-card); border: 1px solid var(--border-card); padding: 12px 13px; clip-path: var(--clip-card); }
.pl-pos .pl-side { flex: none; width: 52px; text-align: center; padding: 7px 0; clip-path: var(--clip-tag); border: 1px solid; align-self: flex-start; }
.pl-pos .pl-side .pl-s { font-size: 9px; font-weight: 900; letter-spacing: 1.1px; text-transform: uppercase; }
.pl-pos .pl-side .pl-p { font-size: 14px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1.2; }
.pl-pos .pl-side.pl-yes { background: var(--lime-bg); border-color: var(--lime-border); }
.pl-pos .pl-side.pl-yes .pl-s, .pl-pos .pl-side.pl-yes .pl-p { color: var(--lime); }
.pl-pos .pl-side.pl-no { background: var(--no-bg); border-color: var(--no-border); }
.pl-pos .pl-side.pl-no .pl-s, .pl-pos .pl-side.pl-no .pl-p { color: var(--no); }
.pl-pos .pl-mid { flex: 1; min-width: 0; }
.pl-pos .pl-mid .pl-q3 { font-size: 12.5px; font-weight: 800; line-height: 1.35; }
.pl-pos .pl-mid .pl-ctx { font-size: 10px; color: var(--text-dim); margin-top: 4px; line-height: 1.45; }
.pl-pos .pl-mid .pl-ctx .pl-livepill { color: var(--color-live); font-weight: 900; }
.pl-pos .pl-mid .pl-stake { font-size: 10.5px; color: var(--text-muted); margin-top: 6px; font-weight: 800; font-variant-numeric: tabular-nums; }
.pl-pos .pl-pnl { flex: none; text-align: right; align-self: center; }
.pl-pos .pl-pnl .pl-d { font-size: 14px; font-weight: 900; font-variant-numeric: tabular-nums; }
.pl-pos .pl-pnl-resolved .pl-d { font-size:20px; white-space:nowrap; }
.pl-result-label { font-size:10px; color:var(--text-secondary); margin-bottom:3px; }
.pl-pos .pl-pnl .pl-d.pl-up { color: var(--lime); }
.pl-pos .pl-pnl .pl-d.pl-down { color: var(--no); }
.pl-pos .pl-pnl .pl-now { font-size: 10px; color: var(--text-dim); margin-top: 3px; font-variant-numeric: tabular-nums; }

/* ── Generated character avatars ───────────────────────────────── */
.pl-av { width: 32px; height: 32px; flex: none; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,.10); }
.pl-av.pl-lg { width: 44px; height: 44px; }
.pl-av svg { display: block; width: 100%; height: 100%; }

/* ── Activity ──────────────────────────────────────────────────── */
.pl-act-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px 10px; }
.pl-act-head .pl-t { font-size: 10px; font-weight: 900; letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-muted); }
.pl-act-head .pl-t em { font-style: normal; color: var(--color-live); }
.pl-act-filters { display: flex; gap: 6px; flex: none; }
.pl-act-filters button {
  background: var(--bg-subtle); border: 1px solid var(--border-base); color: var(--text-muted);
  font-family: inherit; font-size: 9.5px; font-weight: 900; letter-spacing: .7px; text-transform: uppercase;
  padding: 6px 11px; cursor: pointer; clip-path: var(--clip-tag);
}
.pl-act-filters button.pl-on { background: var(--bg-card); border-color: var(--border-strong); color: var(--text-primary); }
.pl-act-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 14px; display: flex; flex-direction: column; gap: 7px; }
.pl-act { display: flex; gap: 10px; align-items: flex-start; background: var(--bg-card); border: 1px solid var(--border-card); padding: 10px 11px; clip-path: var(--clip-card); }
.pl-act .pl-body { flex: 1; min-width: 0; }
.pl-act .pl-line1 { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11.5px; line-height: 1.4; }
.pl-act .pl-who { font-weight: 900; color: var(--text-primary); }
.pl-act .pl-verb { color: var(--text-muted); font-weight: 700; }
.pl-act .pl-chip { font-size: 9px; font-weight: 900; letter-spacing: .8px; padding: 2px 6px; clip-path: var(--clip-tag); text-transform: uppercase; }
.pl-act .pl-chip.pl-yes { background: var(--lime-bg); color: var(--lime); border: 1px solid var(--lime-border); }
.pl-act .pl-chip.pl-no { background: var(--no-bg); color: var(--no); border: 1px solid var(--no-border); }
.pl-act .pl-chip.pl-whale { background: rgba(234,179,8,.12); color: #EAB308; border: 1px solid rgba(234,179,8,.32); }
.pl-act .pl-at { font-weight: 900; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.pl-act .pl-q4 {
  font-size: 11px; color: var(--text-dim); margin-top: 4px; line-height: 1.45;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.pl-act .pl-ago { flex: none; font-size: 9.5px; font-weight: 800; color: var(--text-faint); font-variant-numeric: tabular-nums; padding-top: 2px; }

/* ── Leaderboard ───────────────────────────────────────────────── */
.pl-lb-head { flex: none; padding: 13px 16px 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pl-lb-head h2 { margin: 0; font-size: 20px; font-weight: 900; letter-spacing: -.3px; }
.pl-lb-head .pl-per { display: flex; gap: 5px; flex: none; }
.pl-lb-head .pl-per button {
  background: var(--bg-subtle); border: 1px solid var(--border-base); color: var(--text-muted);
  font-family: inherit; font-size: 9.5px; font-weight: 900; letter-spacing: .6px; text-transform: uppercase;
  padding: 6px 10px; cursor: pointer; clip-path: var(--clip-tag);
}
.pl-lb-head .pl-per button.pl-on { background: var(--lime); border-color: var(--lime); color: #0a0a0a; }

.pl-podium { flex: none; display: grid; grid-template-columns: 1fr 1.16fr 1fr; gap: 8px; align-items: end; padding: 15px 14px 13px; }
.pl-pod {
  background: var(--bg-card); border: 1px solid var(--border-card); clip-path: var(--clip-card);
  padding: 12px 7px 11px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.pl-pod.pl-p1 { border-color: var(--lime-border); background: linear-gradient(180deg, var(--lime-bg), var(--bg-card) 62%); }
.pl-pod .pl-rk { font-size: 9px; font-weight: 900; letter-spacing: 1.2px; color: var(--text-muted); }
.pl-pod.pl-p1 .pl-rk { color: var(--lime); }
.pl-pod .pl-nm { font-size: 11px; font-weight: 900; line-height: 1.25; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-pod .pl-gv { font-size: 14px; font-weight: 900; font-variant-numeric: tabular-nums; color: var(--lime); }
.pl-pod .pl-sec { font-size: 9px; font-weight: 800; color: var(--text-dim); letter-spacing: .4px; }

.pl-lb-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 14px 12px; display: flex; flex-direction: column; gap: 7px; }
.pl-lbr { display: flex; align-items: center; gap: 10px; background: var(--bg-card); border: 1px solid var(--border-card); padding: 9px 11px; clip-path: var(--clip-card); }
.pl-lbr .pl-r { flex: none; width: 20px; text-align: center; font-size: 12px; font-weight: 900; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.pl-lbr .pl-who2 { flex: 1; min-width: 0; }
.pl-lbr .pl-who2 .pl-n2 { font-size: 12.5px; font-weight: 900; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-lbr .pl-who2 .pl-s2 { font-size: 9.5px; font-weight: 800; color: var(--text-dim); margin-top: 2px; letter-spacing: .4px; }
.pl-lbr .pl-g2 { flex: none; text-align: right; }
.pl-lbr .pl-g2 .pl-v2 { font-size: 13px; font-weight: 900; font-variant-numeric: tabular-nums; color: var(--lime); }
.pl-lbr .pl-g2 .pl-m2 { font-size: 9.5px; font-weight: 900; font-variant-numeric: tabular-nums; margin-top: 2px; }
.pl-lbr .pl-g2 .pl-m2.pl-up { color: var(--lime); }
.pl-lbr .pl-g2 .pl-m2.pl-down { color: var(--no); }
.pl-lbr .pl-g2 .pl-m2.pl-flat { color: var(--text-faint); }
/* Pinned "you" row. --lime-bg is rgba(…,.10) — translucent, so list rows
   would scroll visibly *through* the pin and the text would collide. Uses
   the pre-composited opaque equivalent (lime .10 over --bg-card) + a lift. */
.pl-lbr.pl-me { border-color: var(--lime); background: #28311F; position: sticky; bottom: 0; box-shadow: 0 -10px 18px rgba(10,10,10,.8); }
.pl-lbr.pl-me .pl-r { color: var(--lime); }
.pl-lb-note { flex: none; font-size: 9.5px; color: var(--text-faint); text-align: center; padding: 2px 14px 10px; line-height: 1.5; }

/* ── Empty / error / loading ───────────────────────────────────── */
.pl-blank {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px; padding: 28px 30px; text-align: center;
}
.pl-blank .pl-blank-icon {
  width: 54px; height: 54px; display: grid; place-items: center;
  background: var(--bg-card); border: 1px solid var(--border-card); clip-path: var(--clip-tag);
}
.pl-blank .pl-blank-icon svg { width: 24px; height: 24px; fill: none; stroke: var(--text-dim); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.pl-blank h4 { margin: 4px 0 0; font-size: 15px; font-weight: 900; letter-spacing: -.2px; color: var(--text-primary); }
.pl-blank p { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-muted); max-width: 300px; }
.pl-blank .pl-blank-cta { margin-top: 8px; }
.pl-skel {
  background: linear-gradient(90deg, var(--bg-card) 0%, var(--bg-subtle) 50%, var(--bg-card) 100%);
  background-size: 200% 100%; animation: pl-shimmer 1.3s linear infinite;
  border: 1px solid var(--border-card); clip-path: var(--clip-card);
}
@keyframes pl-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }

/* ── Reduced motion ────────────────────────────────────────────────
   Drag itself is direct manipulation and stays — what goes is every
   animation the user did not physically drive: the card's exit, the
   snap-back spring, the tick pop, the blinking live dot, the skeleton
   shimmer. DeckScreen also drops its timeouts to 0 under the same query, so
   a committed move hands over on the next tick instead of waiting out a
   transition that is not running. */
@media (prefers-reduced-motion: reduce) {
  .pl-screen { transition: none; }
  .pl-mcard.pl-anim { transition: opacity .12s ease; }
  .pl-mcard.pl-nav { transition: none; }
  .pl-tick { animation: none; }
  .pl-dot { animation: none; }
  .pl-skel { animation: none; }
}

/* Market browsing uses the same Forge tokens and angular controls as home. */
.pl-screen[hidden] { display: none; }
.pl-explore { display:flex; flex-direction:column; flex:1; min-height:0; }
.pl-time-nav { display:flex; gap:7px; overflow-x:auto; padding:13px 14px; flex:none; border-bottom:1px solid var(--border-base); }
.pl-time-nav button { white-space:nowrap; min-height:40px; padding:8px 13px; color:var(--text-muted); background:var(--bg-card); border:1px solid var(--border-card); font:inherit; font-size:12px; font-weight:800; cursor:pointer; clip-path:var(--clip-tag); }
.pl-time-nav button[aria-pressed=true] { color:#0a0a0a; background:var(--lime); font-weight:900; }
.pl-market-scroll { overflow-y:auto; min-height:0; padding:16px 14px 24px; }
.pl-eyebrow { color:var(--lime); font-size:10px; font-weight:900; letter-spacing:1.6px; }
.pl-explore-heading h1 { font-size:25px; font-weight:900; letter-spacing:-.7px; line-height:1.15; margin:5px 0 17px; }
.pl-search-row { display:flex; gap:8px; margin-bottom:15px; }
.pl-search-row input,.pl-search-row select,.pl-preview-controls select { border:1px solid var(--border-card); background:var(--bg-card); color:var(--text-primary); min-height:42px; padding:9px 10px; font:inherit; font-size:12px; border-radius:3px; }
.pl-search-row input { width:100%; min-width:0; flex:1; }
.pl-search-row select { max-width:40%; }
.pl-preview-controls { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; font-weight:800; }
.pl-preview-controls label { display:flex; align-items:center; gap:8px; }
.pl-preview-controls select { min-height:36px; padding:5px; font-weight:900; }
.pl-preview-controls > span { color:var(--text-muted); font-size:11px; }
.pl-helper { font-size:11px; line-height:1.5; color:var(--text-muted); margin:7px 0; }
.pl-filter-note { margin-bottom:15px; font-size:10px; }
.pl-market-cards { display:flex; flex-direction:column; gap:12px; }
.pl-market-card { background:var(--bg-card); border:1px solid var(--border-card); padding:15px 13px 10px; border-top:2px solid var(--lime-border); border-radius:3px; }
.pl-market-context { font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.7px; color:var(--color-accent); line-height:1.5; }
.pl-live-label { color:var(--color-live); }
.pl-market-card h2 { margin:7px 0 14px; font-size:18px; line-height:1.3; font-weight:900; letter-spacing:-.3px; }
.pl-market-card .pl-vs { position:static; margin:0 0 13px; padding:0; }
.pl-market-card .pl-face { width:32px; height:32px; }
.pl-market-card .pl-pname { color:var(--text-primary); text-shadow:none; font-size:10px; }
.pl-market-card .pl-pline { text-shadow:none; font-size:9px; }
.pl-market-card .pl-pair { gap:8px; }
.pl-market-subtitle,.pl-market-close { color:var(--text-muted); font-size:11px; line-height:1.5; }
.pl-market-close { margin:8px 0; }
.pl-outcomes { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
.pl-outcome { display:flex; justify-content:space-between; align-items:center; gap:5px; padding:12px; min-height:48px; background:var(--lime-bg); color:var(--lime); border:1px solid var(--lime-border); font:inherit; font-size:13px; font-weight:900; cursor:pointer; clip-path:var(--clip-tag); }
.pl-outcome.pl-no { background:var(--no-bg); color:var(--no); border-color:var(--no-border); }
.pl-outcome:hover { filter:brightness(1.2); }
.pl-outcome strong { font-size:16px; font-variant-numeric:tabular-nums; }
.pl-text-link { background:none; border:0; padding:10px 0; min-height:40px; font:inherit; font-size:11px; color:var(--text-muted); cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
.pl-filter-empty { padding:30px 10px; text-align:center; }
.pl-filter-empty h2 { font-size:18px; font-weight:900; }
.pl-filter-empty p { font-size:12px; color:var(--text-muted); }
.pl-list-foot { text-align:center; margin:16px 10px 0; }
.pl-trade-dialog { position:fixed; inset:auto 0 0; margin:0 auto; padding:0; width:min(100%,500px); max-width:100%; max-height:calc(100dvh - 18px); color:var(--text-primary); background:var(--bg-card); border:1px solid var(--border-card); border-top:3px solid var(--lime); border-radius:16px 16px 0 0; overflow-y:auto; }
.pl-trade-dialog::backdrop { background:rgba(0,0,0,.78); backdrop-filter:blur(3px); }
.pl-trade-content { padding:20px 20px max(22px,env(safe-area-inset-bottom)); }
.pl-trade-dialog .pl-sheet-head { margin-bottom:17px; align-items:center; }
.pl-trade-dialog h2 { font-size:20px; font-weight:900; margin:0; }
.pl-trade-dialog .pl-x { width:44px; height:44px; }
.pl-trade-question { font-size:21px; line-height:1.3; font-weight:900; margin:7px 0 17px; }
.pl-choice-toggle { display:flex; gap:6px; margin-bottom:17px; }
.pl-choice-toggle button { flex:1; padding:11px; min-height:44px; border:1px solid var(--border-card); background:var(--bg-subtle); color:var(--text-muted); font:inherit; font-weight:900; clip-path:var(--clip-tag); cursor:pointer; }
/* Follows the deck's mapping. The toggle is the direct continuation of the
   round button the user just pressed — tapping an orange YES and landing on a
   sheet where YES is lime would read as having picked the wrong side. The
   profit/loss colours further down the sheet are NOT sides and keep lime/red. */
.pl-choice-toggle .pl-yes[aria-pressed=true] { background:var(--pl-orange); color:#0a0a0a; }
.pl-choice-toggle .pl-no[aria-pressed=true] { background:var(--lime); color:#0a0a0a; }
.pl-stake-label { display:block; text-align:center; font-size:12px; color:var(--text-muted); }
.pl-stake-input { display:flex; align-items:center; justify-content:center; gap:9px; margin:3px 0; }
.pl-stake-input input { width:190px; max-width:70%; padding:0; font-family:inherit; font-size:46px; font-weight:900; line-height:1.2; text-align:center; background:transparent; color:var(--text-primary); border:0; border-bottom:1px solid var(--border-card); border-radius:0; }
.pl-stake-input .pl-coin { width:32px; height:32px; font-size:20px; }
.pl-available { text-align:center; color:var(--text-muted); font-size:11px; margin:8px 0 16px; }
.pl-available b { color:var(--lime); }
.pl-return-summary { text-align:center; padding:16px 10px 13px; background:var(--lime-bg); border:1px solid var(--lime-border); border-bottom:0; }
.pl-return-summary > span { font-size:12px; font-weight:800; }
.pl-return-summary > strong { display:block; font-size:38px; line-height:1.2; font-weight:900; color:var(--lime); margin:3px 0; }
.pl-return-summary p { font-size:11px; color:var(--text-secondary); margin:5px 0 0; }
.pl-loss-summary,.pl-after { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; font-size:12px; }
.pl-loss-summary { background:var(--no-bg); border:1px solid var(--no-border); }
.pl-loss-summary b { color:var(--no); }
.pl-after { padding:14px 0 4px; color:var(--text-muted); }
.pl-after b { color:var(--text-primary); }
.pl-trade-dialog .pl-helper { font-size:10px; }
.pl-trade-dialog .pn-press { margin-top:12px; }
.pl-trade-error { color:var(--no); font-size:12px; margin:10px 0; }
.pl-root :is(button,input,select):focus-visible,.pl-trade-dialog :is(button,input):focus-visible { outline:2px solid var(--lime); outline-offset:3px; }
@media(max-height:740px) { .pl-trade-content { padding-top:10px; } .pl-trade-question { font-size:18px; margin-bottom:10px; } .pl-trade-dialog .pl-sheet-head { margin-bottom:7px; } .pl-choice-toggle { margin-bottom:10px; } .pl-return-summary { padding:10px; } .pl-stake-input input { font-size:38px; } }

.pl-subnav button.pl-balchip { flex-direction:column; gap:2px; padding:5px 9px; }
.pl-balchip-value { display:flex; align-items:center; gap:5px; }
.pl-balchip-label { font-size:8px; text-transform:uppercase; letter-spacing:.3px; }
.pl-screens { min-height:0; }
@media(min-width:1100px) {
  .pl-screens { height:calc(min(100dvh - 60px, 900px) - 28px - var(--pl-chrome)); }
  .pl-trade-dialog { width:412px; bottom:max(44px,calc(100dvh - 916px)); max-height:calc(min(100dvh - 60px,900px) - 46px); }
}

/* Immersive market feed: each decision occupies one scroll snap. */
.pl-root.pl-immersive { --pl-chrome:calc(var(--pl-navh) + env(safe-area-inset-top,0px)); }
.pl-reels { display:flex; flex-direction:column; flex:1; min-height:0; }
.pl-reel-toolbar { height:60px; flex:none; display:flex; align-items:center; gap:10px; padding:7px 13px; background:var(--bg-base); }
.pl-reel-toolbar > img { width:auto; height:42px; object-fit:contain; }
.pl-reel-toolbar select { width:70px; border:0; background:transparent; color:var(--lime); font-family:inherit; font-size:12px; font-weight:900; }
.pl-reel-toolbar button { font:inherit; font-size:11px; font-weight:800; border:0; color:var(--text-primary); background:transparent; min-height:40px; cursor:pointer; }
.pl-reel-balance { display:flex; align-items:center; gap:5px; margin-left:auto; }
.pl-reel-filter { border-left:1px solid var(--border-card)!important; padding-left:10px; }
.pl-reel-feed { flex:1; min-height:0; overflow-y:auto; scroll-snap-type:y mandatory; overscroll-behavior-y:contain; scrollbar-width:none; }
.pl-reel-feed::-webkit-scrollbar { display:none; }
.pl-reel { height:100%; min-height:460px; position:relative; isolation:isolate; scroll-snap-align:start; scroll-snap-stop:always; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; background:#111711; }
.pl-reel-visual { position:absolute; inset:0; z-index:-2; }
.pl-reel-visual > svg { width:100%; height:100%; }
.pl-reel-visual::after { content:''; position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,.2),transparent 25%,rgba(10,10,10,.7) 55%,#0a0a0a 80%); }
.pl-reel-portraits { display:grid; grid-template-columns:1fr 1fr; height:72%; }
.pl-reel-portraits > div { position:relative; overflow:hidden; background:var(--bg-card); }
.pl-reel-portraits img { object-fit:cover; object-position:center 20%; opacity:.88; }
.pl-reel-portraits span { position:absolute; bottom:12px; left:12px; color:white; text-shadow:0 2px 8px #000; font-size:12px; font-weight:900; }
.pl-reel-top { display:flex; justify-content:space-between; padding:15px; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:1px; }
.pl-reel-top span { padding:5px 9px; background:rgba(0,0,0,.6); border:1px solid rgba(255,255,255,.18); }
.pl-reel-decision { padding:60px 18px 12px; background:linear-gradient(transparent,rgba(10,10,10,.8) 24%,#0a0a0a 85%); }
.pl-reel-decision h1 { font-size:29px; line-height:1.08; letter-spacing:-.7px; font-weight:900; margin:8px 0; text-wrap:balance; }
.pl-reel-meta { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:10px; color:var(--text-muted); }
.pl-reel-meta .pl-text-link { font-size:10px; }
.pl-reel-stake { display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:var(--text-muted); margin:8px 0; }
.pl-reel-stake select { color:var(--text-primary); border:0; background:transparent; font:inherit; font-weight:900; }
.pl-reel .pl-outcome { height:60px; font-size:16px; }
.pl-reel .pl-outcome strong { font-size:23px; }
.pl-reel-note { text-align:center; font-size:9px; color:var(--text-muted); margin:9px 0 0; }
.pl-reel-next { display:block; border:0; background:transparent; color:var(--text-muted); font:inherit; font-size:10px; padding:8px; margin:auto; cursor:pointer; }
.pl-reel-filter-actions { display:flex; align-items:center; justify-content:space-between; gap:15px; }
.pl-reel-filter-actions .pl-amt { padding:12px 20px; }
@media(max-height:740px) { .pl-reel-decision h1 { font-size:24px; } .pl-reel-decision { padding-top:25px; } .pl-reel .pl-outcome { height:50px; } }
@media(prefers-reduced-motion:reduce) { .pl-reel-feed { scroll-behavior:auto; } }

/* Compact card: question first, each choice aligned with its pair. */
.pl-deck-wrap { flex:0 1 490px; }
.pl-card-title { flex:none; padding:20px 17px 10px; margin:0; font-size:21px; background:var(--bg-card); }
.pl-mcard .pl-hero { height:158px; }
.pl-mcard .pl-vs { padding:40px 9px 18px; }
.pl-mcard .pl-mbody { margin-top:0; padding-top:0; flex:1; }
.pl-pair-choices { flex:none; margin:0; padding:0 17px 8px; gap:24px; }
.pl-pair-choices button { font-family:inherit; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:54px; padding:7px; }
.pl-pair-choices button:focus-visible { outline:2px solid var(--text-primary); outline-offset:-4px; }
.pl-mcard .pl-spark { margin-top:10px; }
.pl-mcard .pl-spark svg { height:24px; }
.pl-mcard .pl-model { margin-top:8px; }
@media(max-height:740px) {
 .pl-deck-wrap { flex-basis:420px; }
 .pl-card-title { font-size:18px; padding-top:16px; }
 .pl-mcard .pl-hero { height:142px; }
 .pl-pair-choices button { min-height:48px; }
 .pl-mcard .pl-spark { display:none; }
}

.pl-odds-caption { flex:none; text-align:center; font-size:9px; color:var(--text-muted); margin:0 10px 3px; }
.pl-pair-choices .pl-pct { font-size:24px; }
.pl-mcard .pl-model { margin-top:4px; }

.pl-hero .pl-arena-bg { object-fit:cover; object-position:center 65%; opacity:.8; }

/* One arena image across the card; all content remains above its scrim. */
.pl-root.pl-immersive { --pl-chrome:calc(62px + var(--pl-navh) + env(safe-area-inset-top,0px)); }
.pl-mcard { isolation:isolate; }
.pl-card-backdrop { position:absolute; inset:0; z-index:-1; pointer-events:none; }
.pl-card-backdrop .pl-arena-bg { object-fit:cover; object-position:center; opacity:1; filter:brightness(2.5) saturate(1.1); }
.pl-card-backdrop::after { content:''; position:absolute; inset:0; background:linear-gradient(180deg,rgba(10,10,10,.18),rgba(10,10,10,.04) 45%,rgba(10,10,10,.32)); }
.pl-card-chips { display:flex; flex-wrap:wrap; gap:6px; padding:15px 13px 0; flex:none; position:relative; }
.pl-card-title { background:transparent; padding-top:11px; }
.pl-mcard .pl-hero { background:transparent; height:132px; }
.pl-mcard .pl-hero::after { display:none; }
.pl-mcard .pl-vs { padding:6px 9px 18px; }
@media(max-height:740px) {
 .pl-card-title { padding-top:9px; }
 .pl-mcard .pl-hero { height:116px; }
}

/* House press controls: face moves down into its coloured skirt. */
.pl-pair-choices .pl-choice-press { padding:0; min-height:58px; height:58px; display:block; clip-path:none; color:#0a0a0a; }
.pl-choice-press .pn-press-face { flex-direction:column; gap:2px; color:#0a0a0a; }
.pl-choice-press .pl-lbl { font-size:10px; letter-spacing:1.3px; }
.pl-choice-press .pl-pct { font-size:25px; line-height:1.1; }
.pl-choice-press.pl-yes .pn-press-face { background:var(--pl-orange); }
.pl-choice-press.pl-yes .pn-press-skirt { background:var(--pl-orange-skirt); }
.pl-choice-press.pl-no .pn-press-face { background:var(--lime); }
.pl-choice-press.pl-no .pn-press-skirt { background:var(--lime-skirt); }
.pl-details-nudge { display:flex; align-items:center; justify-content:center; gap:9px; min-height:44px; margin:6px 17px 12px; padding:8px; background:transparent; border:0; font:inherit; font-size:11px; font-weight:800; color:var(--text-secondary); cursor:pointer; }
.pl-details-nudge:hover { color:var(--text-primary); }
.pl-details-nudge:focus-visible { outline:2px solid var(--lime); }
.pl-deck-wrap { flex-basis:430px; }
.pl-amount-dialog { border-radius:0; clip-path:polygon(0% 3%,100% 0%,100% 100%,0% 100%); }
.pl-amount-dialog .pl-trade-content { padding-top:32px; }
.pl-amount-dialog[open] { animation:pl-sheet-enter 320ms cubic-bezier(.22,1,.36,1) both; }
.pl-amount-dialog[open]::backdrop { animation:pl-backdrop-enter 250ms ease-out both; }
.pl-amount-dialog.pl-closing { animation:pl-sheet-exit 180ms ease-in both; pointer-events:none; }
.pl-amount-dialog.pl-closing::backdrop { animation:pl-backdrop-exit 180ms ease-in both; }
@keyframes pl-sheet-enter { from { transform:translateY(100%); opacity:.6; } to { transform:translateY(0); opacity:1; } }
@keyframes pl-sheet-exit { to { transform:translateY(100%); opacity:0; } }
@keyframes pl-backdrop-enter { from { opacity:0; } to { opacity:1; } }
@keyframes pl-backdrop-exit { to { opacity:0; } }
@media(prefers-reduced-motion:reduce) { .pl-amount-dialog[open],.pl-amount-dialog[open]::backdrop { animation:none; } }
@media(max-height:740px) { .pl-deck-wrap { flex-basis:390px; } }

.pl-details-dialog .pl-sheet-head h3 { font-size:20px; font-weight:900; }
.pl-details-dialog .pl-sheet-head p { font-size:14px; line-height:1.4; color:var(--text-primary); }
.pl-details-dialog .pl-dpair { background:var(--bg-subtle); }
.pl-details-dialog :is(.pl-dstats, .pl-dform, .pl-dempty, .pl-dnote, .pl-dsplit span, .pl-pline) { color:var(--text-secondary); }
.pl-details-dialog .pl-dk { color:var(--text-secondary); }
.pl-card-title { text-shadow:0 2px 8px rgba(0,0,0,.85); }
.pl-details-nudge { color:var(--text-primary); text-shadow:0 1px 6px #000; }

/* Play navigation reuses the existing angular tabs and filter chips. */
.pl-root.pl-immersive { --pl-chrome:calc(62px + 50px + var(--pl-navh) + env(safe-area-inset-top,0px)); }
.pl-screens { min-height:0; }
.pl-main-tabs { gap:7px; }
.pl-main-tabs button { min-height:40px; font-size:12px; letter-spacing:0; text-transform:none; }
.pl-market-filters {
 margin:10px 14px 0; padding:3px; gap:3px; overflow-x:auto;
 background:var(--bg-subtle); border:1px solid var(--border-card);
 box-shadow:0 2px 0 rgba(0,0,0,.45);
}
.pl-market-filters button {
 flex:1 0 auto; min-height:40px; padding:8px 10px;
 background:var(--bg-card); border:1px solid var(--border-card);
 font-size:12px; font-weight:700;
 box-shadow:inset 0 -2px 0 rgba(0,0,0,.3);
 transition:background .12s ease,color .12s ease,transform .07s ease;
}
.pl-market-filters button[aria-pressed=true] {
 color:var(--lime); background:var(--lime-bg); border-color:var(--lime-border);
 box-shadow:inset 0 -2px 0 var(--lime); font-weight:900;
}
@media(hover:hover) {
 .pl-market-filters button:hover { background:var(--bg-elevated,var(--bg-card)); color:var(--text-primary); border-color:var(--text-muted); }
 .pl-market-filters button[aria-pressed=true]:hover { background:var(--lime-bg); color:var(--lime); border-color:var(--lime); }
}
.pl-market-filters button:active { box-shadow:none; }
.pl-time-nav button:focus-visible, .pl-per button:focus-visible { outline:2px solid var(--text-primary); outline-offset:-4px; }
.pl-time-nav button:active { transform:translateY(2px); }
.pl-personal-tabs { padding:8px 14px; }
.pl-root:has(.pl-personal-tabs) .pl-screens { height:calc(100dvh - var(--pl-chrome) - 57px); }
.pl-lb-head { align-items:flex-start; flex-direction:column; padding:18px 16px 12px; gap:12px; }
.pl-lb-head h2 { font-size:26px; }
.pl-lb-head .pl-per button { min-height:40px; padding:8px 15px; font-size:12px; }
.pl-standing { display:flex; align-items:center; gap:10px; margin:0 14px 16px; padding:16px 12px; background:var(--bg-card); border:1px solid var(--lime-border); border-left:4px solid var(--lime); clip-path:var(--clip-card); flex:none; }
.pl-standing span { display:block; color:var(--text-secondary); font-size:10px; }
.pl-standing strong { display:block; font-size:25px; line-height:1.3; font-weight:900; }
.pl-standing .pl-av { width:38px; height:38px; }
.pl-standing b { font-size:12px; }
.pl-standing-value { margin-left:auto; text-align:right; }
.pl-standing-value strong { color:var(--lime); font-size:21px; }
.pl-standing-title { margin:0 16px 12px; font-size:19px; font-weight:900; }
.pl-lbr { flex:none; min-height:58px; }
.pl-lbr .pl-r { font-size:20px; }
.pl-lbr:first-child .pl-r { color:var(--pl-orange); }
.pl-lbr.pl-me { position:static; box-shadow:none; }
.pl-lb-note { color:var(--text-secondary); }
@media(max-height:740px) {
 .pl-market-filters { margin-top:6px; }
 .pl-deck { --pl-peek:14px; inset:8px 14px 0; }
 .pl-card-chips { padding-top:10px; }
 .pl-mcard .pl-hero { height:108px; }
 .pl-details-nudge { margin-top:0; margin-bottom:4px; }
 .pl-lb-head { padding-top:10px; gap:6px; }
 .pl-standing { margin-bottom:10px; padding-top:10px; padding-bottom:10px; }
}
/* Keep all five existing bottom-nav items inside narrow Play viewports. */
body:has(.pl-root) .v3-nav-tab { flex:1; min-width:0; padding-left:4px !important; padding-right:4px !important; }
.pl-main-tabs button:not(.pl-on), .pl-time-nav button:not([aria-pressed=true]) { color:var(--text-secondary); }

/* Quiet section tabs above compact, house-style filter controls. */
.pl-main-tabs { padding:0 14px; gap:12px; }
.pl-main-tabs button, .pl-main-tabs button.pl-on {
 height:50px; min-height:44px; clip-path:none; background:transparent;
 border:0; border-bottom:3px solid transparent; box-shadow:none;
 padding:0 2px; font-size:13px; font-weight:800;
}
.pl-main-tabs button.pl-on { color:var(--text-primary); border-bottom-color:var(--lime); }
.pl-main-tabs button:focus-visible { outline:2px solid var(--lime); outline-offset:-5px; }
.pl-filter-toolbar { display:flex; align-items:center; gap:10px; flex:none; padding:12px 14px 2px; }
.pl-filter-toolbar .pl-filter-trigger { min-height:40px; text-transform:none; letter-spacing:0; }
.pl-filter-toolbar .pl-filter-trigger:first-child { flex:1; min-width:0; }
.pl-filter-toolbar .pl-filter-trigger .pn-press-face { gap:8px; justify-content:space-between; font-size:12px; padding:10px 12px; text-transform:none; letter-spacing:0; white-space:nowrap; }
.pl-filter-count { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 4px; background:var(--lime); color:#0a0a0a; font-size:11px; }
.pl-filter-dialog .pl-trade-content { padding-bottom:24px; }
.pl-filter-dialog h2 { font-size:22px; font-weight:900; margin:0; }
.pl-filter-options { display:flex; flex-direction:column; gap:8px; margin-top:10px; }
.pl-filter-options button { min-height:48px; display:flex; align-items:center; justify-content:space-between; padding:12px 16px; font:inherit; font-size:14px; font-weight:800; background:var(--bg-subtle); border:1px solid var(--border-card); color:var(--text-primary); clip-path:var(--clip-tag); cursor:pointer; }
.pl-filter-options button[aria-pressed=true] { color:var(--lime); background:var(--lime-bg); border-color:var(--lime-border); }
.pl-filter-options button:active { transform:translateY(2px); }
.pl-filter-options button:focus-visible, .pl-filter-field select:focus-visible { outline:2px solid var(--lime); outline-offset:-3px; }
.pl-filter-field { display:flex; flex-direction:column; gap:8px; margin:18px 0; font-size:12px; font-weight:800; color:var(--text-secondary); }
.pl-filter-field select { width:100%; min-height:48px; padding:10px 12px; border:1px solid var(--border-card); background:var(--bg-subtle); color:var(--text-primary); font:inherit; font-size:14px; border-radius:0; }
.pl-filter-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:24px; }
@media(max-height:740px) { .pl-filter-toolbar { padding-top:8px; } }

/* Direct filter choices: immediate updates, with optional inline refinements. */
.pl-tap-filters { flex:none; padding:8px 14px 0; position:relative; z-index:5; }
/* Small live signal, with no extra tab height or text. */
.pl-result-notice { margin:8px 16px; padding:12px; border-left:3px solid var(--lime); background:var(--bg-card); font-size:12px; }
.pl-live-nudge { display:inline-block; flex:none; width:6px; height:6px; margin-left:2px; border-radius:50%; background:#ff7846; box-shadow:0 0 0 3px rgba(255,120,70,.14); vertical-align:middle; animation:pl-live-glow 2.4s ease-in-out infinite; }
.pl-main-tabs .pl-live-nudge { margin-left:7px; }
@keyframes pl-live-glow { 50% { box-shadow:0 0 0 4px rgba(255,120,70,.04); } }
@media(prefers-reduced-motion:reduce) { .pl-live-nudge { animation:none; } }
.pl-tap-row { display:flex; align-items:center; gap:5px; overflow-x:auto; padding-bottom:4px; }
.pl-tap-row button { flex:none; display:flex; align-items:center; justify-content:center; gap:5px; min-height:40px; padding:9px 11px; border:1px solid var(--border-card); background:var(--bg-card); color:var(--text-secondary); font:inherit; font-size:12px; font-weight:800; white-space:nowrap; clip-path:var(--clip-tag); cursor:pointer; box-shadow:inset 0 -2px 0 rgba(0,0,0,.3); }
.pl-tap-row button[aria-pressed=true], .pl-tap-row button[aria-expanded=true] { background:var(--lime-bg); color:var(--lime); border-color:var(--lime-border); box-shadow:inset 0 -2px 0 var(--lime); }
.pl-tap-row button:active { transform:translateY(2px); box-shadow:none; }
.pl-tap-row button:focus-visible, .pl-active-filters button:focus-visible { outline:2px solid var(--lime); outline-offset:-3px; }
.pl-inline-filters { position:absolute; top:100%; left:14px; right:14px; padding:12px; background:var(--bg-card); border:1px solid var(--border-card); box-shadow:0 12px 24px rgba(0,0,0,.5); max-height:45dvh; overflow-y:auto; }
.pl-inline-filters fieldset { border:0; padding:0; margin:0 0 8px; min-width:0; }
.pl-inline-filters legend { font-size:11px; font-weight:800; color:var(--text-secondary); margin-bottom:6px; }
.pl-active-filters { display:flex; flex-wrap:wrap; gap:6px; padding:4px 0; }
.pl-active-filters button { min-height:32px; padding:5px 8px; font:inherit; font-size:10px; font-weight:700; background:var(--bg-subtle); color:var(--text-primary); border:1px solid var(--border-card); cursor:pointer; }
.pl-details-dialog .pl-detail { max-height:none; }
.pl-detail-choice-footer { position:sticky; bottom:0; background:var(--bg-card); border-top:1px solid var(--border-card); padding:10px 0 max(12px,env(safe-area-inset-bottom)); z-index:2; }
.pl-detail-choice-footer .pl-pair-choices { gap:12px; padding:0 20px; }
.pl-detail-choice { flex:1; min-width:0; }
.pl-choice-pair { display:block; font-size:11px; font-weight:800; text-align:center; margin-bottom:8px; color:var(--text-primary); }
.pl-detail-choice .pl-choice-press { width:100%; }
@media(max-width:390px) { .pl-tap-filters { padding-left:10px; padding-right:10px; } .pl-tap-row button { padding-left:9px; padding-right:9px; font-size:11px; } }

/* Native vertical browsing keeps every market and its actions in document order. */
.pl-natural-feed { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:14px 14px 24px; display:flex; flex-direction:column; gap:16px; overscroll-behavior-y:contain; touch-action:pan-y; }
.pl-natural-feed:focus-visible { outline:2px solid var(--lime); outline-offset:-3px; }
.pl-natural-feed .pl-market-group > .pl-mcard { position:relative; inset:auto; flex:none; width:100%; min-height:370px; will-change:auto; transform:none; touch-action:pan-y; }
.pl-natural-feed .pl-details-nudge { margin-top:auto; }
@media(max-height:740px) { .pl-natural-feed { padding-top:10px; } .pl-natural-feed .pl-market-group > .pl-mcard { min-height:350px; } }

/* A visual receipt for the actual filled prediction. */
.pl-receipt { overflow-y:auto; padding:0 18px 24px; gap:0; }
.pl-receipt-hero { position:relative; min-height:155px; flex:none; margin:0 -18px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; padding:20px 18px; isolation:isolate; }
.pl-receipt-arena { object-fit:cover; opacity:.55; z-index:-1; filter:brightness(1.8); }
.pl-receipt .pl-tick { position:relative; top:auto; left:auto; transform:none; width:52px; height:52px; clip-path:var(--clip-tag); border-radius:0; box-shadow:none; animation:pl-receipt-arrive .32s ease-out; }
.pl-receipt .pl-tick svg { width:28px; height:28px; }
.pl-receipt h3 { margin:12px 0 0; font-size:24px; text-shadow:0 2px 8px #000; }
.pl-receipt-ticket { flex:none; padding:18px; background:var(--bg-card); border:1px solid var(--border-card); clip-path:var(--clip-card); }
.pl-receipt-top { display:flex; align-items:center; justify-content:space-between; }
.pl-receipt-top > strong { padding:5px 14px; background:var(--pl-orange); color:#0a0a0a; clip-path:var(--clip-tag); text-transform:uppercase; font-size:16px; font-weight:900; }
.pl-receipt-no .pl-receipt-top > strong { background:var(--lime); }
.pl-receipt-ticket h2 { font-size:18px; font-weight:900; line-height:1.25; margin:14px 0; }
.pl-receipt-pair { display:flex; align-items:center; gap:14px; margin-bottom:14px; }
.pl-receipt-pair p { font-size:12px; font-weight:800; color:var(--text-secondary); }
.pl-receipt-stake { display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-top:1px dashed var(--border-card); font-size:12px; color:var(--text-secondary); }
.pl-receipt-stake b { font-size:22px; color:var(--text-primary); }
.pl-receipt small { font-size:.5em; }
.pl-receipt-return { padding:14px; background:var(--lime-bg); border:1px solid var(--lime-border); text-align:center; clip-path:var(--clip-tag); }
.pl-receipt-return > span { display:block; font-size:12px; color:var(--text-primary); font-weight:800; }
.pl-receipt-return > strong { display:block; font-size:40px; line-height:1.2; color:var(--lime); font-weight:900; font-variant-numeric:tabular-nums; margin:5px 0; }
.pl-receipt-return p { margin:0; font-size:10px; color:var(--text-secondary); }
.pl-receipt .pl-confirm-cta { flex:none; margin-top:16px; }
.pl-receipt-next { display:flex; align-items:center; gap:10px; padding:14px 0; margin-top:8px; background:none; border:0; border-top:1px solid var(--border-card); color:var(--text-secondary); font:inherit; text-align:left; cursor:pointer; flex:none; }
.pl-receipt-next span { font-size:10px; } .pl-receipt-next b { flex:1; font-size:12px; color:var(--text-primary); }
@keyframes pl-receipt-arrive { from { opacity:0; transform:scale(.8); } to { opacity:1; transform:scale(1); } }
@media(prefers-reduced-motion:reduce) { .pl-receipt .pl-tick { animation:none; } }
@media(max-height:740px) { .pl-receipt-hero { min-height:120px; padding:14px 18px; } .pl-receipt-ticket { padding:14px; } }

/* Amount entry: one input, one conditional return, secondary details on demand. */
.pl-simple-trade .pl-sheet-head { margin-bottom:10px; }
.pl-simple-trade .pl-sheet-head h2 { font-size:12px; color:var(--text-secondary); font-weight:800; }
.pl-simple-trade .pl-trade-question { margin:0 0 16px; font-size:21px; line-height:1.2; }
.pl-simple-trade .pl-stake-label { margin-top:18px; }
.pl-simple-trade .pl-stake-input input { font-size:44px; }
.pl-simple-trade .pl-available { margin-top:6px; margin-bottom:16px; }
.pl-simple-trade .pl-return-summary { display:flex; align-items:center; justify-content:space-between; gap:14px; text-align:left; padding:14px; margin-top:12px; }
.pl-simple-trade .pl-return-summary span { display:block; font-size:12px; line-height:1.4; }
.pl-simple-trade .pl-return-summary strong { font-size:30px; white-space:nowrap; flex:none; margin:0; }
.pl-simple-trade .pl-return-summary p { font-size:10px; margin:4px 0 0; }
.pl-simple-trade .pl-loss-summary { background:none; border:0; padding:9px 0; font-size:11px; color:var(--text-secondary); }
.pl-simple-trade .pl-loss-summary b { color:var(--no); }
.pl-trade-more { margin:0 0 14px; }
.pl-trade-more summary { cursor:pointer; padding:10px 0; min-height:40px; font-size:11px; color:var(--text-secondary); }
.pl-trade-more summary:focus-visible { outline:2px solid var(--lime); outline-offset:2px; }
.pl-trade-more[open] { border-top:1px solid var(--border-card); }

/* Subtle raised edges inside the existing clipped button shapes. */
.pl-simple-trade .pl-choice-toggle button,
.pl-simple-trade .pl-amt {
 border-color:rgba(255,255,255,.1);
 box-shadow:inset 0 1px 0 rgba(255,255,255,.09), inset 0 -3px 0 rgba(0,0,0,.4);
 transition:background .12s ease,color .12s ease,box-shadow .12s ease,transform .07s ease;
}
.pl-simple-trade .pl-choice-toggle button[aria-pressed=true],
.pl-simple-trade .pl-amt.pl-on {
 box-shadow:inset 0 1px 0 rgba(255,255,255,.28), inset 0 -3px 0 rgba(0,0,0,.24);
}
.pl-simple-trade .pn-press .pn-press-face {
 box-shadow:inset 0 1px 0 rgba(255,255,255,.28), inset 0 0 0 1px rgba(255,255,255,.1);
}
@media(hover:hover) {
 .pl-simple-trade .pl-choice-toggle button:hover:not(:disabled),
 .pl-simple-trade .pl-amt:hover:not(:disabled) { filter:brightness(1.08); }
}
.pl-simple-trade .pl-choice-toggle button:active:not(:disabled),
.pl-simple-trade .pl-amt:active:not(:disabled) {
 transform:translateY(2px);
 box-shadow:inset 0 1px 2px rgba(0,0,0,.2), inset 0 -1px 0 rgba(0,0,0,.2);
}
.pl-simple-trade .pl-choice-toggle button:focus-visible,
.pl-simple-trade .pl-amt:focus-visible { outline:2px solid var(--text-primary); outline-offset:-4px; }
@media(prefers-reduced-motion:reduce) {
 .pl-simple-trade .pl-choice-toggle button, .pl-simple-trade .pl-amt { transition:none; }
}

/* Existing holdings stay visible without competing with the market choice. */
.pl-position-nudge { display:flex; align-items:center; gap:8px; flex:none; margin:0 17px 10px; padding:9px 10px; min-height:40px; background:rgba(20,24,18,.92); border:1px solid var(--lime-border); border-left:3px solid var(--lime); color:var(--text-primary); font:inherit; text-align:left; cursor:pointer; clip-path:var(--clip-tag); }
.pl-position-label { font-size:10px; color:var(--text-secondary); flex:none; }
.pl-position-amounts { flex:1; display:flex; flex-wrap:wrap; gap:3px 10px; font-size:10px; }
.pl-position-yes { color:var(--pl-orange); } .pl-position-no { color:var(--lime); }
.pl-position-nudge > span:last-child { font-size:14px; }
.pl-position-nudge:focus-visible { outline:2px solid var(--lime); outline-offset:-3px; }
.pl-position-nudge:active { transform:translateY(1px); }
/* Played markets default to a compact, reversible summary. */
.pl-natural-feed .pl-market-group > .pl-mcard.pl-card-collapsed { min-height:0; }
.pl-card-open { position:absolute; inset:0; z-index:2; width:100%; height:100%; border:0; padding:0; background:transparent; cursor:pointer; }
.pl-card-open:focus-visible { outline:2px solid var(--lime); outline-offset:-3px; }
@media(hover:hover) { .pl-card-open:hover { background:rgba(255,255,255,.035); } }
.pl-card-open:active { background:rgba(255,255,255,.06); }
.pl-card-collapsed .pl-card-title { font-size:17px; line-height:1.25; }
.pl-card-toggle { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0 17px 10px; padding:8px 10px; min-height:44px; border:1px solid var(--border-card); background:rgba(25,25,25,.8); color:var(--text-primary); font:inherit; font-size:11px; font-weight:700; cursor:pointer; clip-path:var(--clip-tag); box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -2px 0 rgba(0,0,0,.3); }
.pl-card-toggle:active { transform:translateY(1px); }
.pl-card-toggle:focus-visible { outline:2px solid var(--lime); outline-offset:-3px; }
@media(hover:hover) { .pl-card-toggle:hover { background:rgba(45,45,45,.95); } }
`
