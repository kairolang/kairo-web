/**
 * KAIRO // ASCII — shared motion helpers (browser only).
 *
 *   import { reducedMotion, onceVisible, loop } from '@/lib/ascii/motion';
 */

/** Glyph sets used across the system. All are covered by Geist Mono (0.6em advance). */
export const GLYPHS = {
  /** default scramble noise: ASCII only, so width never jitters */
  scramble: '!<>-_\\/[]{}=+*^?#$%&@01',
  /** luminance ramp, dark -> bright */
  ramp: ' .:-=+*#%@',
  /** block shade ramp, dark -> bright */
  blocks: ' ░▒▓█',
  /** hex-ish noise */
  hex: '0123456789ABCDEF',
} as const;

export function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * True on "calm" pages (docs, blog posts): BaseLayout sets
 * <html data-motion="calm">. Reveal / decode / typewriter / counter / field
 * binders resolve straight to their final state there. Hover feedback stays.
 */
export function calmPage(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'calm';
}

/** reducedMotion() || calmPage(): the binders' "skip the entrance" test. */
export function stillPage(): boolean {
  return reducedMotion() || calmPage();
}

/**
 * Session-scoped "have we played this already?" check. Returns true if `key`
 * was seen earlier in this tab session, and (unless mark=false) marks it seen. Storage failures
 * (private mode, blocked) just return false, so the effect plays.
 */
export function seenThisSession(key: string, mark = true): boolean {
  try {
    const k = 'ascii:' + key;
    if (sessionStorage.getItem(k)) return true;
    if (mark) sessionStorage.setItem(k, '1');
  } catch (_) { /* ignore */ }
  return false;
}

/** True on devices with a precise hovering pointer (mouse / trackpad). */
export function finePointer(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/**
 * Call `cb` the first time `el` scrolls into view (then stop observing).
 * One shared IntersectionObserver per (threshold, rootMargin) pair.
 */
const observers = new Map<string, { io: IntersectionObserver; cbs: WeakMap<Element, () => void> }>();
export function onceVisible(
  el: Element,
  cb: () => void,
  { threshold = 0.15, rootMargin = '0px 0px -40px 0px' }: { threshold?: number; rootMargin?: string } = {},
): void {
  if (typeof IntersectionObserver === 'undefined') { cb(); return; }
  const key = `${threshold}|${rootMargin}`;
  let entry = observers.get(key);
  if (!entry) {
    const cbs = new WeakMap<Element, () => void>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const fn = cbs.get(e.target);
        cbs.delete(e.target);
        fn?.();
      }
    }, { threshold, rootMargin });
    entry = { io, cbs };
    observers.set(key, entry);
  }
  entry.cbs.set(el, cb);
  entry.io.observe(el);
}

export interface Loop {
  start(): void;
  stop(): void;
  destroy(): void;
  readonly running: boolean;
}

/**
 * rAF loop that only runs while `el` is on screen AND the tab is visible.
 * `tick(t, dt)` receives seconds since start and seconds since last frame.
 * `fps` caps the frame rate (default 60). Call start() once; it auto-pauses.
 */
export function loop(el: Element, tick: (t: number, dt: number) => void, { fps = 60 }: { fps?: number } = {}): Loop {
  let raf = 0;
  let wanted = false;
  let onScreen = false;
  let last = 0;
  let t0 = 0;
  let acc = 0;
  const minDt = 1000 / fps;

  const frame = (now: number) => {
    raf = 0;
    if (!wanted || !onScreen || document.hidden) return;
    if (!t0) { t0 = now; last = now; }
    const dt = now - last;
    if (dt >= minDt - 1) {
      last = now;
      acc += Math.min(dt, 100); // clamp so a resumed loop doesn't jump
      tick(acc / 1000, Math.min(dt, 100) / 1000);
    }
    raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && wanted && onScreen && !document.hidden) { last = performance.now(); if (!t0) t0 = last; raf = requestAnimationFrame(frame); }
  };
  const io = new IntersectionObserver((es) => { onScreen = es[es.length - 1].isIntersecting; kick(); }, { rootMargin: '64px' });
  io.observe(el);
  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);

  return {
    start() { wanted = true; kick(); },
    stop() { wanted = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    destroy() { this.stop(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); },
    get running() { return raf !== 0; },
  };
}

/** Random glyph from a set. */
export function pick(chars: string): string {
  return chars[(Math.random() * chars.length) | 0];
}

/** Read a CSS custom property from :root (trimmed). */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Run `cb` whenever the site theme flips (data-theme on <html>). Returns an unsubscribe. */
export function onThemeChange(cb: () => void): () => void {
  const mo = new MutationObserver(() => cb());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
