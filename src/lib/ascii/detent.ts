/**
 * KAIRO // ASCII - section detents (non-docs pages).
 *
 * A sticky-but-never-trapping replacement for CSS `scroll-snap-type:
 * y proximity`. Chrome's proximity range is ~1/3 of the viewport, so small
 * wheel / trackpad / touch gestures near a section top were pulled back to
 * it forever. This detent does two small things when a user scroll settles:
 *
 *   1. ARRIVAL: the nearest snap position AHEAD in the gesture's direction
 *      is within reach (~12% vh, 48..110px) -> one smooth scrollTo() onto it.
 *   2. LEAVE RESISTANCE (wheel / touch only): the gesture STARTED on a snap
 *      position S and ended less than `resist` (~15% vh, <= 140px) away from
 *      it -> spring back onto S, once. After that the latch is positional,
 *      not timed: the next push in the same direction that starts on S is
 *      never sprung back, however long the reader paused (one wheel notch,
 *      a coffee, another notch), so a section can't trap anyone. The latch
 *      clears when the page comes to rest anywhere other than S, or when
 *      the direction changes.
 *      Downward resistance only applies to sections that fit the viewport
 *      (inside a tall section, scrolling down is reading, not leaving), and
 *      never at the page top.
 *
 * Snap targets stay pure CSS data: global.css still declares
 * `scroll-snap-align` on sections / [data-snap] / the footer (without a
 * snap-type it is inert), and this reads the computed value, so start /
 * center / end and [data-snap="off"] keep meaning what they did.
 *
 * Never runs: on docs (no html[data-scroll-snap]), under reduced motion,
 * while a box is resized (html.rz-dragging) or held after one
 * (html.rz-snap-hold), after scrollbar drags, #hash jumps or any other
 * programmatic scroll (those come with no wheel/touch/key intent). Keyboard
 * scrolling gets arrival only: an arrow key never bounces back.
 */

const SCROLL_KEYS_DOWN = new Set(['ArrowDown', 'PageDown', ' ']);
const SCROLL_KEYS_UP = new Set(['ArrowUp', 'PageUp']);
const CANDIDATES = 'body > section, body > main > section, [data-snap], body > footer';
/** an intent older than this no longer explains a scroll (ms) */
const INTENT_TTL = 1200;
/** a pause longer than this between intents starts a new gesture (ms) */
const GESTURE_GAP = 200;

let bound = false;
let dir = 0;          // +1 down, -1 up, 0 = no user intent
let intentAt = 0;
let selfScroll = false;
let touchY = 0;
let debounceT = 0;
let rm: MediaQueryList | null = null;
let touching = false;
/** where the page last came to rest (updated on every settle). A passive
 *  wheel listener can run AFTER the compositor already scrolled, so the
 *  gesture's start is this, not scrollY at the first wheel event. */
let restY = 0;
/** restY when the current gesture began (NaN = unknown) */
let gestureStartY = NaN;
/** the gesture may be resisted (wheel / touch, not keys) */
let gestureSoft = false;
/** last spring-back: position + direction. While latched, the next
 *  same-direction gesture starting on springS is let go (never trap). */
let springS = NaN;
let springDir = 0;
let springLatched = false;
// reused per settle() (no allocations per gesture beyond the DOM query)
const snapTop: number[] = [];
const snapTall: boolean[] = [];

function intent(d: number, soft: boolean) {
  if (!d) return;
  const now = performance.now();
  if (now - intentAt > GESTURE_GAP) {
    gestureStartY = restY;
    gestureSoft = soft;
  }
  dir = d > 0 ? 1 : -1;
  intentAt = now;
  selfScroll = false; // the user took over from any detent scroll in flight
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey) return; // pinch-zoom
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  intent(e.deltaY, true);
}
function onTouchStart(e: TouchEvent) {
  touchY = e.touches[0]?.clientY ?? 0;
  touching = true;
  if (performance.now() - intentAt > GESTURE_GAP) { gestureStartY = restY; gestureSoft = true; }
}
function onTouchMove(e: TouchEvent) {
  const y = e.touches[0]?.clientY ?? touchY;
  if (Math.abs(y - touchY) > 2) intent(touchY - y, true); // finger up = page scrolls down
  touchY = y;
}
function onTouchEnd(e: TouchEvent) {
  if (e.touches.length) return;
  touching = false;
  if (!('onscrollend' in window)) onScroll(); // fallback: settle after momentum
}
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && t.closest?.('input, textarea, select, [contenteditable], .rz-handle')) return;
  if (e.key === ' ' && e.shiftKey) return intent(-1, false);
  if (SCROLL_KEYS_DOWN.has(e.key)) return intent(1, false);
  if (SCROLL_KEYS_UP.has(e.key)) return intent(-1, false);
  // Home / End / anything else: a jump, not a nudge, so no detent
  if (e.key === 'Home' || e.key === 'End') dir = 0;
}
function dropIntent() { dir = 0; gestureStartY = NaN; }

function settle() {
  debounceT = 0;
  if (touching) return; // finger still down: wait for touchend / scrollend
  // a wheel / key intent just arrived: its scroll hasn't run yet, so this
  // scrollend is not the end of the gesture; look again shortly
  if (!selfScroll && performance.now() - intentAt < 60) {
    debounceT = window.setTimeout(settle, 140);
    return;
  }
  // every exit below is a resting point, except when a detent scroll starts
  // (its own scrollend lands here again with selfScroll and records it)
  if (!decide()) {
    restY = window.scrollY;
    // came to rest off the sprung-back position: the escape latch is spent
    if (springLatched && Math.abs(restY - springS) > 2) springLatched = false;
  }
}

/** @returns true when it started a detent scroll */
function decide(): boolean {
  if (selfScroll) { selfScroll = false; return false; }
  const d = dir;
  const startY = gestureStartY;
  const soft = gestureSoft;
  dir = 0; // one decision per gesture
  gestureStartY = NaN;
  const now = performance.now();
  if (!d || now - intentAt > INTENT_TTL) return false;
  const html = document.documentElement;
  if (!html.hasAttribute('data-scroll-snap')) return false;
  if (html.classList.contains('rz-dragging') || html.classList.contains('rz-snap-hold')) return false;
  if (rm?.matches) return false;

  const vh = window.innerHeight;
  const y = window.scrollY;
  const max = Math.max(0, html.scrollHeight - vh);
  const reach = Math.max(48, Math.min(110, vh * 0.12));
  const resist = Math.min(140, vh * 0.15);
  const pad = parseFloat(getComputedStyle(html).scrollPaddingTop) || 0;

  snapTop.length = 0;
  snapTall.length = 0;
  const els = document.querySelectorAll<HTMLElement>(CANDIDATES);
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const align = getComputedStyle(el).scrollSnapAlign.split(' ')[0];
    if (!align || align === 'none') continue;
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    let top: number;
    if (align === 'end') top = y + r.bottom - vh;
    else if (align === 'center') top = y + r.top + r.height / 2 - vh / 2;
    else top = y + r.top - pad;
    snapTop.push(Math.round(Math.min(max, Math.max(0, top))));
    snapTall.push(r.height > (vh - pad) * 1.1);
  }

  // 1. leave resistance: started on S, moved off it by less than `resist`
  if (soft && startY === startY) {
    for (let i = 0; i < snapTop.length; i++) {
      const S = snapTop[i];
      if (Math.abs(startY - S) > 2) continue;
      const off = (y - S) * d; // > 0 = moved away from S along the gesture
      if (off <= 2 || off >= resist) continue;
      if (d > 0 && (S <= 2 || snapTall[i])) continue; // page top / reading a tall section
      if (springLatched && springDir === d && Math.abs(springS - S) <= 2) {
        springLatched = false; // second push: let it go (never trap)
        break;
      }
      springS = S; springDir = d; springLatched = true; // (re)latch; a new direction replaces the old
      selfScroll = true;
      window.scrollTo({ top: S, behavior: 'smooth' });
      return true;
    }
  }

  // 2. arrival: the nearest snap AHEAD within reach
  let best = Infinity;
  for (let i = 0; i < snapTop.length; i++) {
    const dist = (snapTop[i] - y) * d; // > 0 = ahead of the gesture
    if (dist >= 2 && dist <= reach && dist < best) best = dist;
  }
  if (best === Infinity) return false;
  selfScroll = true;
  window.scrollTo({ top: y + best * d, behavior: 'smooth' });
  return true;
}

function onScroll() {
  // fallback for engines without `scrollend`
  if (debounceT) clearTimeout(debounceT);
  debounceT = window.setTimeout(settle, 140);
}
function onScrollEnd() {
  if (debounceT) { clearTimeout(debounceT); debounceT = 0; }
  settle();
}

/** Idempotent; BaseLayout calls it once per page. */
export function initDetent(): void {
  if (bound || typeof window === 'undefined') return;
  if (!document.documentElement.hasAttribute('data-scroll-snap')) return;
  bound = true;
  rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  restY = window.scrollY;
  const opt = { passive: true, capture: true } as const;
  window.addEventListener('wheel', onWheel, opt);
  window.addEventListener('touchstart', onTouchStart, opt);
  window.addEventListener('touchmove', onTouchMove, opt);
  window.addEventListener('touchend', onTouchEnd, opt);
  window.addEventListener('touchcancel', onTouchEnd, opt);
  window.addEventListener('keydown', onKey, opt);
  // a click (link, #hash, scrollbar) or hash change is never a nudge
  window.addEventListener('pointerdown', dropIntent, opt);
  window.addEventListener('hashchange', dropIntent);
  if ('onscrollend' in window) window.addEventListener('scrollend', onScrollEnd, { passive: true });
  else window.addEventListener('scroll', onScroll, { passive: true });
}
