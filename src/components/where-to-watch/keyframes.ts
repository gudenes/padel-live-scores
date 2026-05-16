// src/components/where-to-watch/keyframes.ts
//
// Shared CSS keyframes for the Where-to-Watch popup. Imported by the
// popup component and rendered once inside <style> on open.
//
// Names prefixed `wtw-` to avoid colliding with any other animations.
// Reduced-motion gate at the bottom disables all animations on a single
// `[data-wtw-anim]` selector.

export const WTW_KEYFRAMES = `
@keyframes wtw-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes wtw-pop-in {
  0%   { opacity: 0; transform: scale(0.7); }
  55%  { opacity: 1; transform: scale(1.05); }
  78%  { transform: scale(0.98); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes wtw-eyebrow-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes wtw-row-pop {
  0%   { opacity: 0; transform: translateY(18px) scale(0.94); }
  60%  { opacity: 1; transform: translateY(-2px) scale(1.01); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes wtw-stream-in {
  from { opacity: 0; transform: translateX(-10px); }
  to   { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-wtw-anim] {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
.wtw-close-btn {
  position: absolute;
  top: 0;
  right: 0;
  /* Sit above the eyebrow + group content. Without this, the 56×56 hit
     area is shadowed by the full-width eyebrow div that follows in DOM
     order, so taps near the X land on the eyebrow (which has no
     handler) instead of the button. */
  z-index: 2;
  width: 56px;
  height: 56px;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
  color: #fff;
  font-family: inherit;
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.wtw-close-btn::before {
  content: '';
  position: absolute;
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.06);
  clip-path: polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%);
  pointer-events: none;
}
.wtw-close-btn > span {
  position: relative;
  pointer-events: none;
}
`
