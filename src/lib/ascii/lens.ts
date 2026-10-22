/**
 * KAIRO // ASCII — rect lens for LARGE display text (FIGlet titles, big headings).
 *
 *   import { lensReveal, bindLens } from '@/lib/ascii/lens';
 *   lensReveal(el);                                   // shade-in sweep on first view + cursor lens
 *   lensReveal(el, { hover: false, delay: 120 });     // sweep only (DOM is restored afterwards)
 *   <div data-lens>…art…</div>                         // auto (bindLens / AsciiArt / AsciiTitle)
 *
 * The "blurish" look is the ASCII shade vocabulary (░ ▒ ▓), NOT a CSS blur:
 *
 * LOAD-IN: every non-space glyph starts as a dim shade char (░/▒), chosen
 * DETERMINISTICALLY per cell from the final glyph's ink density + a stable
 * (row, col) hash. A rectangular window (full art height, ~8–14 columns)
 * sweeps across once, left → right (~900ms, eased, snapped to whole columns).
 * Inside the window cells show a denser shade (▓/▒/░) at full art colour;
 * behind it the art is final. Each cell changes at most twice and only ever
 * gets brighter: dim shade → dense shade → final glyph. Nothing re-rolls.
 *
 * HOVER (fine pointer only): the same rectangle follows the cursor
 * horizontally (eased) and renders the glyphs inside it in the dense-shade
 * style (like the hero figure's block-ramp lens); it cross-fades in/out.
 *
 * How (cheap): the target's content is wrapped into three stacked copies
 *   .lens-box   (position: relative)
 *     .lens-base   the original nodes (in flow; masked while a lens is live)
 *     .lens-veil   aria-hidden inert clone, dim shade glyphs (shown ahead of the window)
 *     .lens-glass  aria-hidden inert clone, dense shade glyphs (shown inside the window)
 * The shade copies are built once. Per frame only --lens-l/-r/-a change on
 * the host (and only when the column-snapped values actually change); they
 * drive clip-path insets and one mask gradient. No layout, no filters.
 *
 * Reduced motion: final at once, no hover lens. Calm pages (docs/blog): no
 * sweep; the hover lens is user-triggered feedback, so it stays.
 *
 * data-lens values: "" | "on" (sweep + hover) · "reveal" (sweep only) ·
 * "hover" (hover only, no sweep) · "off". Extras: data-lens-delay="120",
 * data-lens-duration="900" (clamped 700–1100), data-lens-cols="10".
 */
import { finePointer, onceVisible, reducedMotion, stillPage } from './motion';

export interface LensOptions {
  /** play the shade-in sweep. Default true (skipped under reduced motion / calm pages) */
  reveal?: boolean;
  /** rect lens follows the cursor (fine pointers only). Default true */
  hover?: boolean;
  /** sweep duration in ms (clamped 700–1100). Default 900 */
  duration?: number;
  /** wait before the sweep starts, ms. Default 60 */
  delay?: number;
  /** start the sweep when the element first scrolls into view. Default true */
  whenVisible?: boolean;
  /** window width in columns. Default auto: ~20% of the art, clamped to 8–14 cols */
  cols?: number;
}

/* ─── deterministic shade glyphs ───────────────────────────────────── */

/** ink density of a final glyph, 0..1 (-1 = keep as-is: whitespace / line-break chars) */
function density(c: string): number {
  switch (c) {
    case ' ': case '\n': case '\t': case '\r': case ' ':
    case '-': case '‐': case '–': case '—': case '/':
      return -1;
    case '█': return 1;
    case '▓': return 0.8;
    case '▀': case '▄': case '▌': case '▐': case '▒': return 0.5;
    case '░': return 0.25;
    case '.': case ',': case '\'': case '`': case ':': case ';': return 0.15;
  }
  const code = c.charCodeAt(0);
  if (code >= 0x2500 && code <= 0x257f) return 0.3; // box drawing (FIGlet shadows ╗║═╝╚╔)
  return 0.6; // letters, digits, other ink
}

/** stable 0..1 hash of a cell */
function cellHash(row: number, col: number): number {
  const h = Math.imul(row + 1, 0x27d4eb2d) ^ Math.imul(col + 7, 0x165667b1);
  return (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0) / 4294967296;
}

/**
 * The shade glyph for one cell. level 0 = dim "ahead" state (░/▒),
 * level 1 = dense "inside the lens" state (▓/▒/░). Pure + deterministic.
 */
export function lensShade(c: string, row: number, col: number, level: 0 | 1): string {
  const d = density(c);
  if (d < 0) return c;
  const h = cellHash(row, col);
  if (level === 0) return d >= 0.45 ? (h < 0.6 ? '▒' : '░') : '░';
  // inside the lens: never more ink than the final glyph (monotonic brightening)
  if (d >= 0.75) return h < 0.8 ? '▓' : '▒';
  return '░';
}

/** Replace every text node under `root` with its shade glyphs (row/col tracked across nodes). */
function shadeTree(root: HTMLElement, level: 0 | 1): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let row = 0, col = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) { if ((n as Element).tagName === 'BR') { row++; col = 0; } continue; }
    const t = n as Text;
    const src = t.data;
    let out = '';
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\n') { out += c; row++; col = 0; continue; }
      out += lensShade(c, row, col, level);
      col++;
    }
    t.data = out;
  }
}

/* ─── state ───────────────────────────────────────────────────────── */

const Mode = { Idle: 0, Wait: 1, Sweep: 2, Hover: 3 } as const;
type ModeT = (typeof Mode)[keyof typeof Mode];

interface LensState {
  el: HTMLElement;
  boxes: HTMLElement[];
  targets: HTMLElement[];
  cols: number[];      // longest line per box (art); 0 = plain text
  hover: boolean;
  mode: ModeT;
  t0: number;
  dur: number;
  delay: number;
  x0: number;          // sweep: window left edge, start / end
  x1: number;
  gx: number;          // window centre (hover) or left edge (sweep), px from box left
  gw: number;          // window width px (whole columns)
  cw: number;          // column width px (snap grid; 0 = no snap)
  vi: number;          // index of the rendered box (measured at sweep start / hover enter)
  a: number;           // hover strength 0..1
  tx: number;
  px: number;
  inside: boolean;
  colsOpt: number;
  wl: number; wr: number; wa: number; // last written values (skip redundant writes)
  done: Promise<void>;
  resolve: () => void;
  off: (() => void) | null;
}

const states = new WeakMap<HTMLElement, LensState>();

/* ─── styles (injected once; the pre-JS hidden state lives in AsciiArt.astro) ── */
const MASK_SWEEP = 'linear-gradient(90deg,#000 var(--lens-l),transparent var(--lens-l))';
const MASK_HOVER = 'linear-gradient(90deg,#000 var(--lens-l),rgb(0 0 0/calc(1 - var(--lens-a))) var(--lens-l) var(--lens-r),#000 var(--lens-r))';
const CSS = `
.lens-host{--lens-l:0px;--lens-r:0px;--lens-a:0}
.lens-box{display:block;position:relative}
.lens-box>.lens-base{display:block}
.lens-box>.lens-layer{position:absolute;inset:0;display:none;pointer-events:none;user-select:none;-webkit-user-select:none}
.lens-host.lens-loading .lens-base{-webkit-mask-image:${MASK_SWEEP};mask-image:${MASK_SWEEP}}
.lens-host.lens-hovering:not(.lens-loading) .lens-base{-webkit-mask-image:${MASK_HOVER};mask-image:${MASK_HOVER}}
.lens-host.lens-loading .lens-veil{display:block;clip-path:inset(0 0 0 var(--lens-r))}
.lens-host.lens-active .lens-glass{display:block;opacity:var(--lens-a);clip-path:inset(0 calc(100% - var(--lens-r)) 0 var(--lens-l))}
.lens-host .lens-box>.lens-veil{color:var(--lens-dim,color-mix(in srgb,currentColor 36%,var(--bg)))}
.lens-host .lens-box>.lens-veil *{color:inherit}
.lens-host .lens-box>.lens-veil .s{color:color-mix(in srgb,currentColor 55%,var(--bg))}
.lens-host .lens-box>.lens-glass .f{color:var(--lens-face,color-mix(in oklab,var(--art-face,var(--red)) 80%,var(--red-hi)))}
@media (prefers-reduced-motion: reduce){.lens-host .lens-layer{display:none!important}.lens-host .lens-base{-webkit-mask-image:none!important;mask-image:none!important}}
`;
let cssDone = false;
function injectCss(): void {
  if (cssDone) return;
  cssDone = true;
  if (document.getElementById('ascii-lens-css')) return;
  const s = document.createElement('style');
  s.id = 'ascii-lens-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ─── shared rAF: runs only while a sweep or a hover lens is live ── */
const live = new Set<LensState>();
let raf = 0;
let lastNow = 0;
function kick(s: LensState): void {
  live.add(s);
  if (!raf) { lastNow = performance.now(); raf = requestAnimationFrame(frame); }
}
function frame(now: number): void {
  raf = 0;
  const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  for (const s of live) if (!step(s, now, dt)) live.delete(s);
  if (live.size) raf = requestAnimationFrame(frame);
}

/* ─── structure ─────────────────────────────────────────────────── */
function stripClone(n: HTMLElement): void {
  n.setAttribute('aria-hidden', 'true');
  n.setAttribute('inert', '');
  n.removeAttribute('id');
  n.querySelectorAll('[id]').forEach((c) => c.removeAttribute('id'));
}

function longestLine(t: HTMLElement): number {
  let m = 0;
  for (const line of (t.textContent || '').split('\n')) if (line.length > m) m = line.length;
  return m;
}

function build(s: LensState): void {
  const { el } = s;
  const arts = el.matches('.ascii-art') ? [el] : Array.from(el.querySelectorAll<HTMLElement>('.ascii-art'));
  const targets = arts.length ? arts : [el];
  for (const t of targets) {
    const isArt = t.classList.contains('ascii-art');
    s.cols.push(isArt ? longestLine(t) : 0);
    if (t.firstElementChild?.classList.contains('lens-box')) { s.boxes.push(t.firstElementChild as HTMLElement); s.targets.push(t); continue; }
    const box = document.createElement('span');
    box.className = 'lens-box';
    const base = document.createElement('span');
    base.className = 'lens-base';
    while (t.firstChild) base.appendChild(t.firstChild);
    const veil = base.cloneNode(true) as HTMLElement;
    veil.className = 'lens-layer lens-veil';
    stripClone(veil);
    shadeTree(veil, 0);
    const glass = base.cloneNode(true) as HTMLElement;
    glass.className = 'lens-layer lens-glass';
    stripClone(glass);
    shadeTree(glass, 1);
    box.append(base, veil, glass);
    t.appendChild(box);
    s.boxes.push(box);
    s.targets.push(t);
  }
  el.classList.add('lens-host');
}

/** Restore the original DOM (sweep-only lenses, once settled). */
function unwrap(s: LensState): void {
  s.boxes.forEach((box, i) => {
    const t = s.targets[i];
    const base = box.firstElementChild;
    if (base) while (base.firstChild) t.insertBefore(base.firstChild, box);
    box.remove();
  });
  s.el.classList.remove('lens-host', 'lens-loading', 'lens-active', 'lens-hovering');
  ['--lens-l', '--lens-r', '--lens-a'].forEach((p) => s.el.style.removeProperty(p));
  if (!s.el.getAttribute('style')) s.el.removeAttribute('style');
  s.boxes.length = 0;
  s.targets.length = 0;
  s.cols.length = 0;
  states.delete(s.el);
}

/** Index of the box that is actually rendered (wide/narrow FIGlet variants swap by container). */
function visibleIdx(s: LensState): number {
  for (let i = 0; i < s.boxes.length; i++) if (s.boxes[i].offsetWidth > 0) return i;
  return 0;
}

/** column grid + window width from the visible box (one read, at sweep start / hover enter) */
function measure(s: LensState): number {
  const i = (s.vi = visibleIdx(s));
  const box = s.boxes[i];
  if (!box) return 0;
  let W = box.offsetWidth;
  const cols = s.cols[i];
  let colW: number;
  if (cols > 0) {
    colW = W / cols;
    s.cw = colW;
  } else {
    // plain text heading: sweep the text's own extent, not the full block width; no snapping
    const base = box.firstElementChild;
    if (base) {
      const rg = document.createRange();
      rg.selectNodeContents(base);
      const tr = rg.getBoundingClientRect(), br = box.getBoundingClientRect();
      if (tr.width > 0) W = Math.min(W, Math.ceil(tr.right - br.left));
    }
    const cs = getComputedStyle(box);
    colW = (parseFloat(cs.fontSize) || 16) * 0.6 + (parseFloat(cs.letterSpacing) || 0);
    s.cw = 0;
  }
  if (colW <= 0) colW = 8;
  const total = Math.max(1, Math.round(W / colW));
  const want = s.colsOpt > 0 ? s.colsOpt : Math.round(total * 0.2);
  const n = Math.max(Math.min(8, Math.max(2, Math.round(total * 0.35))), Math.min(want, 14));
  s.gw = n * colW;
  return W;
}

const snap = (v: number, cw: number) => (cw > 0 ? Math.round(v / cw) * cw : v);

function write(s: LensState, l: number, r: number): void {
  const L = snap(l, s.cw), R = snap(r, s.cw), A = Math.round(s.a * 100) / 100;
  if (L === s.wl && R === s.wr && A === s.wa) return;
  s.wl = L; s.wr = R; s.wa = A;
  const st = s.el.style;
  st.setProperty('--lens-l', L.toFixed(2) + 'px');
  st.setProperty('--lens-r', R.toFixed(2) + 'px');
  st.setProperty('--lens-a', String(A));
}

/** Sweep finished: final everywhere. Returns true if the hover lens takes over. */
function settle(s: LensState): boolean {
  s.el.classList.remove('lens-loading');
  s.el.setAttribute('data-lens-done', '');
  s.resolve();
  if (!s.hover) { unwrap(s); s.mode = Mode.Idle; return false; }
  s.el.classList.remove('lens-active');
  s.a = 0;
  if (s.inside) {
    s.mode = Mode.Hover;
    s.gx = s.tx;
    s.el.classList.add('lens-active', 'lens-hovering');
    return true;
  }
  s.mode = Mode.Idle;
  return false;
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) * (-2 * k + 2)) / 2);

function step(s: LensState, now: number, dt: number): boolean {
  if (s.mode === Mode.Wait) {
    if (now - s.t0 < s.delay) return true;
    const W = measure(s);
    s.x0 = -s.gw;
    s.x1 = W + s.cw;
    s.gx = s.x0; s.a = 1;
    s.wl = s.wr = s.wa = NaN;
    s.mode = Mode.Sweep;
    s.t0 = now;
    s.el.classList.add('lens-active');
  }
  if (s.mode === Mode.Sweep) {
    const k = (now - s.t0) / s.dur;
    if (k >= 1) return settle(s);
    s.gx = s.x0 + (s.x1 - s.x0) * ease(k);
    // never let a column step backwards (monotonic reveal)
    const l = Math.max(s.wl === s.wl ? s.wl : -Infinity, snap(s.gx, s.cw));
    write(s, l, l + s.gw);
    return true;
  }
  if (s.mode !== Mode.Hover) return false;
  if (s.inside) {
    const box = s.boxes[s.vi];
    if (box) s.tx = s.px - box.getBoundingClientRect().left; // one read, before the writes below
  }
  if (s.a < 0.04 && s.inside) s.gx = s.tx;
  else s.gx += (s.tx - s.gx) * Math.min(1, dt * 12);
  s.a += ((s.inside ? 1 : 0) - s.a) * Math.min(1, dt * (s.inside ? 9 : 8));
  if (!s.inside && s.a < 0.02) {
    s.a = 0;
    s.mode = Mode.Idle;
    s.el.classList.remove('lens-active', 'lens-hovering');
    return false;
  }
  const l = snap(s.gx - s.gw / 2, s.cw);
  write(s, l, l + s.gw);
  // settled on the cursor: park the loop until the pointer moves again
  return !(s.inside && s.a > 0.99 && Math.abs(s.tx - s.gx) < 0.3);
}

function bindHover(s: LensState): void {
  const { el } = s;
  const enter = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    s.inside = true; s.px = e.clientX;
    // the sweep owns the window (also while it is still pending, waiting to scroll into view)
    if (s.mode === Mode.Wait || s.mode === Mode.Sweep || el.classList.contains('lens-loading')) return;
    if (s.mode === Mode.Idle) {
      measure(s);
      s.wl = s.wr = s.wa = NaN;
      s.mode = Mode.Hover;
      el.classList.add('lens-active', 'lens-hovering');
    }
    kick(s);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    s.px = e.clientX;
    if (!s.inside) enter(e);
    else if (s.mode === Mode.Hover) kick(s);
  };
  const leave = () => { s.inside = false; if (s.mode === Mode.Hover) kick(s); };
  el.addEventListener('pointerenter', enter, { passive: true });
  el.addEventListener('pointermove', move, { passive: true });
  el.addEventListener('pointerleave', leave, { passive: true });
  s.off = () => {
    el.removeEventListener('pointerenter', enter);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerleave', leave);
  };
}

/** Already in the viewport at bind time? (one read; an ancestor's print-in clip would delay IO) */
function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < (window.innerHeight || 0);
}

/**
 * Rect-lens reveal for large display text. Idempotent per element: a second
 * call returns the first call's promise. Resolves once the text is final.
 * The shaded first state is in place synchronously when this returns.
 */
export function lensReveal(el: HTMLElement, opts: LensOptions = {}): Promise<void> {
  const prev = states.get(el);
  if (prev) return prev.done;
  if (el.hasAttribute('data-lens-done') && el.hasAttribute('data-lens-bound')) return Promise.resolve();
  el.setAttribute('data-lens-bound', '');

  const reduced = reducedMotion();
  const reveal = (opts.reveal ?? true) && !stillPage();
  const hover = (opts.hover ?? true) && !reduced && finePointer();
  if (!reveal && !hover) { el.setAttribute('data-lens-ready', ''); el.setAttribute('data-lens-done', ''); return Promise.resolve(); }

  injectCss();
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  const s: LensState = {
    el, boxes: [], targets: [], cols: [], hover, mode: Mode.Idle, t0: 0,
    dur: Math.min(1100, Math.max(700, opts.duration ?? 900)),
    delay: Math.max(0, opts.delay ?? 60),
    x0: 0, x1: 0, gx: 0, gw: 0, cw: 0, vi: 0, a: 0, tx: 0, px: 0, inside: false,
    colsOpt: opts.cols ?? 0, wl: NaN, wr: NaN, wa: NaN, done, resolve, off: null,
  };
  states.set(el, s);
  build(s);
  if (hover) bindHover(s);

  if (!reveal) { el.setAttribute('data-lens-ready', ''); el.setAttribute('data-lens-done', ''); resolve(); return done; }

  // shaded + dim until the window passes (CSS defaults park the window at x=0: all veil)
  el.classList.add('lens-loading');
  el.setAttribute('data-lens-ready', '');
  const start = () => { s.mode = Mode.Wait; s.t0 = performance.now(); kick(s); };
  if (opts.whenVisible === false || inView(el)) start();
  else onceVisible(el, start, { threshold: 0.1, rootMargin: '0px' });
  return done;
}

/** Tear down a lens (restores the original DOM). */
export function destroyLens(el: HTMLElement): void {
  const s = states.get(el);
  if (!s) return;
  s.off?.();
  live.delete(s);
  s.resolve();
  unwrap(s);
  el.removeAttribute('data-lens-bound');
}

/** Bind every [data-lens] element under root. Idempotent. */
export function bindLens(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-lens]:not([data-lens-bound])').forEach((el) => {
    const v = (el.dataset.lens || 'on').toLowerCase();
    if (v === 'off' || v === 'false') { el.setAttribute('data-lens-bound', ''); el.setAttribute('data-lens-ready', ''); return; }
    const num = (k: string) => { const n = parseInt(el.dataset[k] || '', 10); return Number.isFinite(n) ? n : undefined; };
    void lensReveal(el, {
      reveal: v !== 'hover',
      hover: v !== 'reveal',
      delay: num('lensDelay'),
      duration: num('lensDuration'),
      cols: num('lensCols'),
    });
  });
}

/** True if el is block-level (the lens needs a block box; inline text gets a plain fade). */
export function lensable(el: HTMLElement): boolean {
  const d = getComputedStyle(el).display;
  return !d.startsWith('inline') && d !== 'contents' && d !== 'none';
}
