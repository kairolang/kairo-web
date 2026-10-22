/**
 * KAIRO // ASCII - text scramble / decode.
 *
 *   import { scramble, bindScramble } from '@/lib/ascii/scramble';
 *   await scramble(el, { duration: 450 });          // decode el's current text
 *   await scramble(el, { text: 'exit 0' });          // decode INTO new text
 *
 * Works on any element: only TEXT NODES are touched (icons/SVG/children stay),
 * so it is safe on buttons with an <svg> arrow. Use it on monospace text:
 * the default glyph set is ASCII so a Geist Mono line never changes width.
 *
 * Auto-binding (wired globally by BaseLayout via initAscii()):
 *   <h2 data-scramble>…</h2>                 decode once when first visible
 *   <h2 data-scramble="700" data-scramble-delay="120">  custom duration/delay (ms)
 *   <a data-scramble-hover>…</a>             re-scramble on hover / keyboard focus
 *   .ascii-btn, .btn-primary, .btn-outline, .nav-link scramble on hover automatically
 *   data-scramble-hover="off"                opt an element out
 *
 * Reduced motion: everything resolves instantly with the final text.
 * Calm pages (docs/blog): [data-scramble] decodes are skipped (final text at
 * once); hover scramble on nav/buttons still runs.
 *
 * PHOTOSENSITIVITY: large display text (computed font-size >= 24px, or
 * data-scramble-soft) is NEVER glyph-scrambled. It delegates to the rect lens
 * (lens.ts): the heading loads in as dim shade glyphs (░▒, deterministic per
 * cell) and a rectangular window sweeps across it once, resolving each column
 * to the final text. Inline-level large text just fades up from dim. Hover
 * re-scrambles skip large text entirely. Small-text noise is capped: it
 * refreshes at <= 12fps and each glyph re-rolls at most 3 times before it
 * locks, so even small text never churns.
 *
 * RESTRAINT: headings, nav and buttons only, never paragraphs or code.
 * Hover re-scrambles have a per-element cooldown so sweeping the pointer
 * across a nav row doesn't make it churn.
 */
import { GLYPHS, onceVisible, pick, reducedMotion, stillPage } from './motion';
import { lensReveal, lensable } from './lens';

export interface ScrambleOptions {
  /** total time until the last glyph locks, ms. Default 450 */
  duration?: number;
  /** wait before starting, ms. Default 0 */
  delay?: number;
  /** noise glyphs. Default GLYPHS.scramble (ASCII) */
  chars?: string;
  /** decode into this text instead of the element's current text (replaces el's text content) */
  text?: string;
  /** glyph refresh rate (small text). Default 12, capped at 12 */
  fps?: number;
  /** large display text: no glyph noise; rect-lens shade-in (block) or a fade (inline).
   *  Default: auto (font-size >= 24px or data-scramble-soft) */
  soft?: boolean;
}

/** Large text (or opted-in) gets the soft, low-contrast decode. */
function wantsSoft(el: HTMLElement): boolean {
  if (el.hasAttribute('data-scramble-soft')) return true;
  return parseFloat(getComputedStyle(el).fontSize) >= 24;
}

const tokens = new WeakMap<Element, number>();
const originals = new WeakMap<Text, string>();
let tokenSeq = 0;

function textNodes(el: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('svg, [data-scramble-skip]')) return NodeFilter.FILTER_REJECT;
      return /\S/.test(n.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/**
 * Large text: no glyph re-rolling at all. Block-level elements get the rect
 * lens (shade-in, a window sweeps once); inline ones fade up from dim.
 */
function softReveal(el: HTMLElement, duration: number, delay: number): Promise<void> {
  if (lensable(el)) {
    const p = lensReveal(el, { hover: false, whenVisible: false, delay, duration: Math.min(1000, Math.max(700, duration * 1.6)) });
    el.setAttribute('data-scrambled', ''); // shown only now: the shaded first state is already in place
    return p;
  }
  el.setAttribute('data-scrambled', '');
  if (typeof el.animate !== 'function') return Promise.resolve();
  const a = el.animate([{ opacity: 0.35 }, { opacity: 0.35, offset: delay / (delay + duration) }, { opacity: 1 }], { duration: delay + duration, easing: 'ease-out' });
  return a.finished.then(() => undefined, () => undefined);
}

export function scramble(el: HTMLElement, opts: ScrambleOptions = {}): Promise<void> {
  const { duration = 450, delay = 0, chars = GLYPHS.scramble, text } = opts;
  const fps = Math.min(12, opts.fps ?? 12);
  const MAX_ROLLS = 3; // per glyph, before it locks
  const busy = tokens.has(el);

  if (text !== undefined) {
    // restore any in-flight originals first so we don't leak garbage
    el.textContent = text;
  }
  if (!reducedMotion() && duration > 0 && !busy && (opts.soft ?? wantsSoft(el))) return softReveal(el, duration, delay);
  el.setAttribute('data-scrambled', '');
  if (reducedMotion() || duration <= 0) {
    if (busy && text === undefined) for (const n of textNodes(el)) { const o = originals.get(n); if (o !== undefined) n.data = o; }
    tokens.delete(el);
    return Promise.resolve();
  }

  const nodes = textNodes(el);
  const finals = nodes.map((n) => {
    const o = busy && text === undefined ? originals.get(n) ?? n.data : n.data;
    originals.set(n, o);
    return o;
  });

  // Accessible name stays stable for interactive elements while glyphs churn.
  const interactive = el.matches('a, button, [role="button"]');
  const hadLabel = el.hasAttribute('aria-label');
  if (interactive && !hadLabel && !busy) el.setAttribute('aria-label', finals.join('').replace(/\s+/g, ' ').trim());

  // Per-character lock times: left-to-right sweep with jitter.
  const total = finals.reduce((n, s) => n + s.length, 0) || 1;
  const lock: number[][] = [];
  let k = 0;
  for (const s of finals) {
    const row: number[] = [];
    for (let i = 0; i < s.length; i++, k++) row.push(delay + (k / total) * duration * 0.6 + Math.random() * duration * 0.4);
    lock.push(row);
  }

  const token = ++tokenSeq;
  tokens.set(el, token);
  const frameMs = 1000 / fps;
  // paint noise synchronously so the final text never flashes first
  const cur: string[][] = [];
  const rolls: Uint8Array[] = [];
  nodes.forEach((n, i) => {
    const src = finals[i];
    const row: string[] = new Array(src.length);
    for (let j = 0; j < src.length; j++) row[j] = /\s/.test(src[j]) ? src[j] : pick(chars);
    cur.push(row);
    rolls.push(new Uint8Array(src.length).fill(1));
    n.data = row.join('');
  });

  return new Promise((resolve) => {
    const t0 = performance.now();
    let lastPaint = -Infinity;
    const finish = () => {
      nodes.forEach((n, i) => { n.data = finals[i]; });
      if (interactive && !hadLabel) el.removeAttribute('aria-label');
      tokens.delete(el);
      resolve();
    };
    const frame = (now: number) => {
      if (tokens.get(el) !== token) { resolve(); return; } // superseded
      const t = now - t0;
      if (t >= delay + duration) { finish(); return; }
      if (now - lastPaint >= frameMs) {
        lastPaint = now;
        nodes.forEach((n, i) => {
          const src = finals[i];
          const lk = lock[i], row = cur[i], rl = rolls[i];
          let s = '';
          for (let j = 0; j < src.length; j++) {
            const c = src[j];
            if (c === ' ' || c === '\n' || c === '\t' || t >= lk[j]) row[j] = c;
            else if (rl[j] < MAX_ROLLS) { row[j] = pick(chars); rl[j]++; }
            s += row[j];
          }
          n.data = s;
        });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

const HOVER_SEL = '[data-scramble-hover], .ascii-btn, .btn-primary, .btn-outline, .nav-link';
let delegated = false;

function hoverTarget(e: Event): HTMLElement | null {
  const t = e.target as Element | null;
  const el = t && 'closest' in t ? (t.closest(HOVER_SEL) as HTMLElement | null) : null;
  if (!el || el.getAttribute('data-scramble-hover') === 'off') return null;
  return el;
}

/**
 * Bind [data-scramble] (decode on first view) and hover scrambling.
 * Idempotent: safe to call on every page load.
 */
export function bindScramble(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-scramble]:not([data-scramble-bound])').forEach((el) => {
    el.setAttribute('data-scramble-bound', '');
    const dur = parseInt(el.dataset.scramble || '', 10);
    const delay = parseInt(el.dataset.scrambleDelay || '', 10);
    if (stillPage()) { el.setAttribute('data-scrambled', ''); return; }
    onceVisible(el, () => { void scramble(el, { duration: Number.isFinite(dur) ? Math.min(dur, 900) : 450, delay: Number.isFinite(delay) ? delay : 0 }); });
  });

  if (delegated) return;
  delegated = true;
  const lastRun = new WeakMap<Element, number>();
  const COOLDOWN = 900; // ms before the same element may re-scramble on hover
  const run = (el: HTMLElement) => {
    if (tokens.has(el) || reducedMotion() || wantsSoft(el)) return; // never churn large text
    const now = performance.now();
    if (now - (lastRun.get(el) ?? -Infinity) < COOLDOWN) return;
    lastRun.set(el, now);
    const d = parseInt(el.dataset.scrambleHover || '', 10);
    void scramble(el, { duration: Number.isFinite(d) ? Math.min(d, 350) : 220 });
  };
  document.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    const el = hoverTarget(e);
    if (!el) return;
    const from = (e as PointerEvent).relatedTarget as Node | null;
    if (from && el.contains(from)) return; // moving within the element
    run(el);
  }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const el = hoverTarget(e);
    if (el && (el as HTMLElement).matches(':focus-visible')) run(el);
  });
}
