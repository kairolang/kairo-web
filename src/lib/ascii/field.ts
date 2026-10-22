/**
 * KAIRO // ASCII - animated glyph field on <canvas>.
 *
 * A grid of monospace cells; each frame a luminance function returns 0..1
 * per cell, which picks a glyph from a ramp (" .:-=+*#%@") AND a red shade
 * (--red-lo -> --red -> --red-hi). Glyphs are pre-rendered once into an
 * atlas canvas and blitted with drawImage, so a frame is pure arithmetic +
 * ~10k cheap blits. ALL fields share ONE requestAnimationFrame scheduler and
 * ONE pointer listener; a field only ticks while it is on screen and the tab
 * is visible. DPR is capped, cell count is capped (lower on narrow screens),
 * and reduced motion / calm pages render ONE still frame.
 *
 *   import { createField, presets, withPointer } from '@/lib/ascii/field';
 *   const field = createField(hostEl, { fn: 'plasma', size: 14, fps: 24 });
 *   field.start();            // (auto-paused when offscreen / hidden)
 *   field.setFn(withPointer(presets.noise, 160));
 *   field.destroy();
 *
 * Markup auto-binding (wired globally by initAscii()):
 *   <div class="ascii-field" data-ascii-field="plasma" data-field-size="14"
 *        data-field-fps="24" data-field-pointer="on" aria-hidden="true"></div>
 *   (presets: plasma | noise | rain | ripple | static)
 *   data-field-still              render ONE frame, no loop
 *   data-field-strength="0.3"     pointer-halo strength 0..1 (default 0.6)
 *   data-field-t0="3.2"           time offset (s): the first animated frame equals the still frame
 *   data-field-hole="cx cy rx ry" skip cells inside this ellipse (fractions of w/h; under a mask's clear centre)
 *   data-field-skip-x="x0 x1"     skip columns whose centre x/w is in [x0, x1) (a linear mask's clear side)
 *
 * The host must be positioned (the .ascii-field class does it: absolute, inset 0).
 * The canvas is inserted as its first child, absolutely filling it.
 *
 * RESTRAINT: looping fields are for the homepage only (hero + the slow
 * section bands); everywhere else use a still frame (data-field-still /
 * renderOnce). Keep fields behind content at opacity ~0.15-0.45 and give copy
 * a solid backing (.on-field). Presets are tuned slow and drift smoothly (no
 * per-frame re-rolls); 'static' re-rolls at <=2.5 Hz so it can never strobe.
 * Calm pages (docs/blog) and reduced motion: one still frame (a calm-page
 * field may opt back in with animateOnCalm; reduced motion always wins).
 *
 * Other canvas effects can join the same rAF loop with fieldLoop(el, tick,
 * { fps }) (same shape as motion.ts loop()), and resolve colour stops with
 * resolveColor(ctx, '--red').
 */
import { GLYPHS, cssVar, onThemeChange, reducedMotion, stillPage, type Loop } from './motion';

export interface FieldPointer {
  /** pointer in host CSS px (raw) */
  x: number;
  y: number;
  /** eased pointer, follows x/y with ~80ms lag; use this for smooth halos */
  sx: number;
  sy: number;
  /** pointer is over/near the host */
  active: boolean;
  /** 0..1, rises while the pointer moves, decays when it rests */
  energy: number;
}

export interface FieldEnv {
  cols: number;
  rows: number;
  /** cell size in CSS px */
  cellW: number;
  cellH: number;
  /** host size in CSS px */
  w: number;
  h: number;
}

/** (x, y) = cell centre in host CSS px; t = seconds; return intensity 0..1 (<= threshold draws nothing). */
export type FieldFn = (x: number, y: number, t: number, p: FieldPointer, env: FieldEnv) => number;

export interface FieldOptions {
  fn?: FieldFn | PresetName;
  /** glyph font size in CSS px. Cell = 0.6*size x lineHeight*size. Default 14 */
  size?: number;
  lineHeight?: number; // default 1.25
  ramp?: string;       // default GLYPHS.ramp
  /** colour stops, low -> high. CSS colours or var names ('--red'). Default ['--red-lo','--red','--red-hi'] */
  colors?: string[];
  shades?: number;     // colour quantisation levels, default 6
  fps?: number;        // default 24; 0 = render one still frame, no loop
  dpr?: number;        // DPR cap, default 1.5
  pointer?: boolean;   // track pointer, default true (ignored on touch-only / reduced motion)
  threshold?: number;  // below this nothing is drawn, default 0.06
  maxCells?: number;   // auto-grow cell size above this many cells, default 16000
  /** narrow screens (<=640px): glyph size multiplier and cell budget. Defaults 1.2 / 6000 */
  narrowScale?: number;
  narrowMaxCells?: number;
  /** seconds added to the animation clock, so frame 0 can match the still frame. Default 0 */
  t0?: number;
  /** time (s) used for the single still frame under reduced motion. Default 3.2 */
  stillTime?: number;
  /** keep animating on calm pages (docs/blog); reduced motion still renders one frame. Default false */
  animateOnCalm?: boolean;
  /**
   * Cheap cull, checked BEFORE fn: cells whose centre falls inside this ellipse
   * (centre + radii as fractions of the host w/h) are never evaluated or drawn.
   * Use it for the fully transparent middle of a radial CSS mask (or under a
   * solid pane): same look, far fewer blits.
   */
  hole?: { cx: number; cy: number; rx: number; ry: number };
  /** cheap cull: columns whose centre x/w is in [x0, x1) are skipped (a linear mask's transparent side) */
  skipX?: { x0: number; x1: number };
}

export interface FieldHandle {
  canvas: HTMLCanvasElement;
  start(): void;
  stop(): void;
  destroy(): void;
  /** draw a single frame at time t (seconds) */
  renderOnce(t?: number): void;
  setFn(fn: FieldFn | PresetName): void;
  resize(): void;
}

/* ─── Noise ─────────────────────────────────────────────────────── */
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = (t: number) => t * t * (3 - 2 * t);
/** Smooth value noise in [0,1]. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  return l(
    l(l(c000, c100, xf), l(c010, c110, xf), yf),
    l(l(c001, c101, xf), l(c011, c111, xf), yf),
    zf,
  );
}
export const noise2 = (x: number, y: number) => noise3(x, y, 0);
/** stable per-integer random in [0,1] */
export const rand1 = (i: number) => hash3(i, 17, 91);

/* ─── Presets ───────────────────────────────────────────────────── */
export const presets = {
  /** interfering sine waves; slow, dense, pointer-lit */
  plasma: ((x, y, T, p, e) => {
    const t = T * 0.55; // slow drift
    const u = x / e.w, v = y / e.h;
    let s = Math.sin(u * 7 + t * 0.9) + Math.sin((v * 5 - t * 0.6) + Math.sin(u * 3 + t * 0.4) * 1.5)
      + Math.sin((u + v) * 6 - t * 0.7);
    s = (s + 3) / 6; // 0..1
    return s * s * 0.85 * (0.35 + 0.65 * v);
  }) as FieldFn,
  /** drifting fractal noise, darker at the edges */
  noise: ((x, y, t, _p, e) => {
    const nx = x / 90, ny = y / 70;
    const n = noise3(nx, ny, t * 0.16) * 0.65 + noise3(nx * 2.1, ny * 2.1, t * 0.26 + 7) * 0.35;
    const vx = x / e.w - 0.5, vy = y / e.h - 0.5;
    const vig = 1 - Math.min(1, (vx * vx + vy * vy) * 2.2);
    return Math.max(0, (n - 0.35) * 1.9) * vig;
  }) as FieldFn,
  /** falling streaks per column (stateless "digital rain") */
  rain: ((x, y, t, _p, e) => {
    const col = Math.floor(x / e.cellW);
    const sp = 0.12 + rand1(col) * 0.3;
    const ph = rand1(col + 999);
    const f = ((y / e.h) * 1.6 - t * sp + ph) % 1;
    const g = f < 0 ? f + 1 : f;
    return Math.pow(g, 7) * (0.4 + rand1(col + 31) * 0.6);
  }) as FieldFn,
  /** rings from the centre */
  ripple: ((x, y, t, _p, e) => {
    const dx = x - e.w / 2, dy = (y - e.h / 2) * 1.6;
    const d = Math.sqrt(dx * dx + dy * dy);
    const r = Math.sin(d / 18 - t * 1.4) * 0.5 + 0.5;
    return r * r * Math.max(0, 1 - d / Math.max(e.w, e.h)) * 0.9;
  }) as FieldFn,
  /** sparse TV static (re-rolls 2.5x/s: below the photosensitivity flicker range) */
  static: ((x, y, t, _p, e) => {
    const c = Math.floor(x / e.cellW), r = Math.floor(y / e.cellH), f = Math.floor(t * 2.5);
    const n = hash3(c, r, f);
    return n > 0.93 ? n : 0;
  }) as FieldFn,
};
export type PresetName = keyof typeof presets;

/**
 * Wrap a field fn with a pointer "halo": cells near the (eased) pointer brighten.
 * radius in CSS px. strength 0..1.
 */
export function withPointer(fn: FieldFn, radius = 140, strength = 0.6): FieldFn {
  const r2 = radius * radius;
  return (x, y, t, p, e) => {
    const base = fn(x, y, t, p, e);
    if (!p.active) return base;
    const dx = x - p.sx, dy = (y - p.sy) * 1.15;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2 * 4) return base;
    const h = Math.exp(-d2 / r2) * strength * (0.45 + 0.55 * p.energy);
    return Math.min(1, base + h);
  };
}

/** Render a field to a plain string (build time or SSR-like fallbacks). */
export function fieldToString(cols: number, rows: number, fn: FieldFn, t = 0, ramp: string = GLYPHS.ramp, cellW = 8.4, cellH = 17.5): string {
  const env: FieldEnv = { cols, rows, cellW, cellH, w: cols * cellW, h: rows * cellH };
  const p: FieldPointer = { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4, active: false, energy: 0 };
  const glyphs = [...ramp];
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = Math.max(0, Math.min(0.9999, fn((c + 0.5) * cellW, (r + 0.5) * cellH, t, p, env)));
      out += glyphs[Math.floor(v * glyphs.length)];
    }
    if (r < rows - 1) out += '\n';
  }
  return out;
}

/* ─── Shared scheduler + pointer ───────────────────────────────── */
/**
 * One rAF loop drives every animated field on the page. Each job keeps its
 * own fps cap and clock; jobs that are offscreen (one shared
 * IntersectionObserver) or unwanted are skipped, and the loop stops itself
 * when nothing is runnable or the tab is hidden. No allocations per frame.
 */
interface Job {
  el: Element;
  tick: (t: number, dt: number) => void;
  minDt: number;
  last: number;
  acc: number;
  wanted: boolean;
  onScreen: boolean;
}
const jobs: Job[] = [];
let raf = 0;
let jobIO: IntersectionObserver | null = null;
let visBound = false;

function runnable(j: Job): boolean { return j.wanted && j.onScreen; }

function schedFrame(now: number) {
  raf = 0;
  if (document.hidden) return;
  let any = false;
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    if (!runnable(j)) continue;
    any = true;
    const dt = now - j.last;
    if (dt >= j.minDt - 1) {
      const d = dt > 100 ? 100 : dt; // clamp so a resumed field doesn't jump
      j.last = now;
      j.acc += d;
      j.tick(j.acc / 1000, d / 1000);
    }
  }
  if (any) raf = requestAnimationFrame(schedFrame);
}
function schedKick() {
  if (raf || document.hidden) return;
  for (let i = 0; i < jobs.length; i++) if (runnable(jobs[i])) { raf = requestAnimationFrame(schedFrame); return; }
}
function resumeClock(j: Job) { j.last = performance.now(); }

function addJob(el: Element, tick: Job['tick'], fps: number): Job {
  const j: Job = { el, tick, minDt: 1000 / Math.max(1, fps), last: 0, acc: 0, wanted: false, onScreen: false };
  jobs.push(j);
  jobIO ??= new IntersectionObserver((es) => {
    for (const e of es) {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.el !== e.target) continue;
        if (e.isIntersecting && !job.onScreen) resumeClock(job);
        job.onScreen = e.isIntersecting;
      }
    }
    schedKick();
  }, { rootMargin: '64px' });
  jobIO.observe(el);
  if (!visBound) {
    visBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      for (let i = 0; i < jobs.length; i++) resumeClock(jobs[i]);
      schedKick();
    });
  }
  return j;
}
function removeJob(j: Job) {
  const i = jobs.indexOf(j);
  if (i >= 0) jobs.splice(i, 1);
  j.wanted = false;
  if (!jobs.some((o) => o.el === j.el)) jobIO?.unobserve(j.el);
}

/**
 * Join the shared field scheduler with any per-frame callback: same contract
 * as motion.ts loop() (tick(t, dt) in seconds, paused offscreen and while the
 * tab is hidden), but every caller shares ONE requestAnimationFrame.
 * Call start() once; stop() pauses; destroy() leaves the scheduler.
 */
export function fieldLoop(el: Element, tick: (t: number, dt: number) => void, { fps = 24 }: { fps?: number } = {}): Loop {
  const j = addJob(el, tick, fps);
  return {
    start() { if (!j.wanted) { j.wanted = true; resumeClock(j); schedKick(); } },
    stop() { j.wanted = false; },
    destroy() { removeJob(j); },
    get running() { return runnable(j) && !document.hidden; },
  };
}

/** shared pointer state (viewport px); epochs let fields skip rect reads when nothing changed */
const gp = { x: -1e4, y: -1e4, inside: false, moveEpoch: 0, layoutEpoch: 0 };
let pointerBound = false;
function bindPointer() {
  if (pointerBound) return;
  pointerBound = true;
  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    gp.x = e.clientX; gp.y = e.clientY; gp.inside = true; gp.moveEpoch++;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { gp.inside = false; gp.moveEpoch++; });
  const bump = () => { gp.layoutEpoch++; };
  window.addEventListener('scroll', bump, { passive: true });
  window.addEventListener('resize', bump, { passive: true });
}

/* ─── Renderer ──────────────────────────────────────────────────── */
/** CSS colour or custom-property name ('--red') -> [r, g, b], via a 2D context's colour parser. */
export function resolveColor(ctx: CanvasRenderingContext2D, c: string): [number, number, number] {
  const v = c.startsWith('--') ? cssVar(c) || '#e8102a' : c;
  ctx.fillStyle = '#000';
  ctx.fillStyle = v;
  const s = String(ctx.fillStyle);
  if (s.startsWith('#')) {
    const n = parseInt(s.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/[\d.]+/g) || ['232', '16', '42'];
  return [+m[0], +m[1], +m[2]];
}

export function createField(host: HTMLElement, opts: FieldOptions = {}): FieldHandle {
  const o = {
    size: 14, lineHeight: 1.25, ramp: GLYPHS.ramp as string, colors: ['--red-lo', '--red', '--red-hi'],
    shades: 6, fps: 24, dpr: 1.5, pointer: true, threshold: 0.06, maxCells: 16000, stillTime: 3.2,
    narrowScale: 1.2, narrowMaxCells: 6000, t0: 0,
    ...(Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as FieldOptions),
  };
  const still = (o.animateOnCalm ? reducedMotion() : stillPage()) || opts.fps === 0;
  let fn: FieldFn = typeof o.fn === 'function' ? o.fn : presets[o.fn ?? 'plasma'] ?? presets.plasma;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'ascii-field-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  host.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true })!;
  const atlas = document.createElement('canvas');
  const actx = atlas.getContext('2d')!;
  const glyphs = [...o.ramp];

  const env: FieldEnv = { cols: 0, rows: 0, cellW: 0, cellH: 0, w: 0, h: 0 };
  const ptr: FieldPointer = { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4, active: false, energy: 0 };
  let cwD = 0, chD = 0, dpr = 1, size = o.size;
  let lastT = 0;
  // culls (resolved in resize): skipped column span [xa, xb] (empty when xa > xb)
  const hole = opts.hole && opts.hole.rx > 0 && opts.hole.ry > 0 ? opts.hole : null;
  let xa = 0, xb = -1;

  function buildAtlas() {
    actx.canvas.width = Math.max(1, cwD * glyphs.length);
    actx.canvas.height = Math.max(1, chD * o.shades);
    actx.clearRect(0, 0, atlas.width, atlas.height);
    actx.font = `500 ${size * dpr}px "Geist Mono", ui-monospace, monospace`;
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    const stops = o.colors.map((c) => resolveColor(actx, c));
    for (let s = 0; s < o.shades; s++) {
      const f = o.shades === 1 ? 1 : s / (o.shades - 1);
      const seg = Math.min(stops.length - 2, Math.floor(f * (stops.length - 1)));
      const lf = f * (stops.length - 1) - seg;
      const a = stops[Math.max(0, seg)], b = stops[Math.min(stops.length - 1, seg + 1)];
      const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * lf));
      actx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      for (let g = 1; g < glyphs.length; g++) actx.fillText(glyphs[g], g * cwD + cwD / 2, s * chD + chD / 2);
    }
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, o.dpr);
    const narrow = window.innerWidth <= 640;
    size = narrow ? o.size * o.narrowScale : o.size;
    // above 1920px wide, grow glyphs with the viewport so very large screens keep
    // the same look (and roughly the same cell count) instead of hitting maxCells
    if (!narrow && window.innerWidth > 1920) size *= window.innerWidth / 1920;
    const budget = narrow ? Math.min(o.maxCells, o.narrowMaxCells) : o.maxCells;
    // grow cells until under the budget
    while ((w / (size * 0.6)) * (h / (size * o.lineHeight)) > budget) size *= 1.12;
    cwD = Math.max(1, Math.round(size * 0.6 * dpr));
    chD = Math.max(1, Math.round(size * o.lineHeight * dpr));
    env.cellW = cwD / dpr; env.cellH = chD / dpr;
    env.cols = Math.ceil(w / env.cellW); env.rows = Math.ceil(h / env.cellH);
    env.w = w; env.h = h;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    if (opts.skipX && env.cellW > 0) {
      // cell c is skipped when its centre (c + .5) * cellW lies in [x0*w, x1*w)
      xa = Math.max(0, Math.ceil((opts.skipX.x0 * w) / env.cellW - 0.5));
      xb = Math.ceil((opts.skipX.x1 * w) / env.cellW - 0.5) - 1;
    }
    rectStale = true;
    buildAtlas();
  }

  function draw(t: number) {
    lastT = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const n = glyphs.length, S = o.shades, th = o.threshold;
    const { cols, rows, cellW, cellH, w, h } = env;
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * cellH, dy = r * chD;
      // per-row span of the elliptical hole: cells whose centre is strictly inside it
      let ea = 0, eb = -1;
      if (hole && h > 0) {
        const ey = (y / h - hole.cy) / hole.ry;
        if (ey > -1 && ey < 1) {
          const hw = hole.rx * Math.sqrt(1 - ey * ey) * w;
          const mid = hole.cx * w;
          ea = Math.floor((mid - hw) / cellW - 0.5) + 1;
          eb = Math.ceil((mid + hw) / cellW - 0.5) - 1;
        }
      }
      for (let c = 0; c < cols; c++) {
        if (c >= xa && c <= xb) { c = xb; continue; }
        if (c >= ea && c <= eb) { c = eb; continue; }
        let v = fn((c + 0.5) * cellW, y, t, ptr, env);
        if (!(v > th)) continue;
        if (v > 0.9999) v = 0.9999;
        const g = Math.max(1, Math.floor(v * n));
        const s = Math.floor(v * S);
        ctx.drawImage(atlas, g * cwD, s * chD, cwD, chD, c * cwD, dy, cwD, chD);
      }
    }
  }

  // pointer: shared window listener; the host rect is re-read only after a
  // pointer move, scroll or resize (no per-frame layout reads when idle)
  const usePointer = o.pointer && !still;
  if (usePointer) bindPointer();
  let seenMove = 0, seenLayout = -1, rectStale = true, rLeft = 0, rTop = 0, rW = 0, rH = 0;

  const tick = (t: number, dt: number) => {
    if (usePointer) {
      const moved = gp.moveEpoch !== seenMove;
      if (moved || rectStale || gp.layoutEpoch !== seenLayout) {
        rectStale = false;
        seenLayout = gp.layoutEpoch;
        const rect = host.getBoundingClientRect(); // single read, no writes before it
        rLeft = rect.left; rTop = rect.top; rW = rect.width; rH = rect.height;
      }
      seenMove = gp.moveEpoch;
      ptr.x = gp.x - rLeft; ptr.y = gp.y - rTop;
      ptr.active = gp.inside && ptr.x > -200 && ptr.y > -200 && ptr.x < rW + 200 && ptr.y < rH + 200;
      if (ptr.sx < -1e3) { ptr.sx = ptr.x; ptr.sy = ptr.y; }
      const k = Math.min(1, dt * 12);
      ptr.sx += (ptr.x - ptr.sx) * k; ptr.sy += (ptr.y - ptr.sy) * k;
      ptr.energy = Math.min(1, ptr.energy * Math.pow(0.25, dt) + (moved ? 0.25 : 0));
    }
    draw(t + o.t0);
  };
  const job = still ? null : addJob(host, tick, o.fps);
  const isRunning = () => !!job && job.wanted && job.onScreen && !document.hidden;

  let pending = 0;
  const ro = new ResizeObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      // the observer always fires once right after observe(); resize() resets
      // canvas.width, which wipes the frame painted below, and a running field
      // would then sit blank until its next tick (~83ms at 12fps). Skip it when
      // nothing that resize() measures has changed.
      if (host.clientWidth === env.w && host.clientHeight === env.h
        && Math.min(window.devicePixelRatio || 1, o.dpr) === dpr) return;
      resize();
      if (still || !isRunning()) draw(still ? o.stillTime : lastT || o.t0);
    });
  });
  ro.observe(host);
  const offTheme = onThemeChange(() => { buildAtlas(); if (still || !isRunning()) draw(still ? o.stillTime : lastT || o.t0); });

  resize();
  // fonts: re-rasterise the atlas once Geist Mono is in
  document.fonts?.load(`500 ${o.size}px "Geist Mono"`, o.ramp).then(() => { buildAtlas(); if (still) draw(o.stillTime); }).catch(() => {});

  if (still) draw(o.stillTime);
  else draw(o.t0); // paint frame 0 now so there's no empty band before the first tick

  return {
    canvas,
    start() {
      if (still) { draw(o.stillTime); return; }
      if (job && !job.wanted) { job.wanted = true; resumeClock(job); schedKick(); }
    },
    stop() { if (job) job.wanted = false; },
    destroy() {
      if (job) removeJob(job);
      ro.disconnect(); offTheme();
      canvas.remove();
    },
    renderOnce(t = o.stillTime) { draw(t); },
    setFn(f) { fn = typeof f === 'function' ? f : presets[f] ?? presets.plasma; if (still) draw(o.stillTime); },
    resize,
  };
}

/** Auto-bind [data-ascii-field] hosts. Idempotent. */
export function bindFields(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-ascii-field]:not([data-field-bound])').forEach((el) => {
    el.setAttribute('data-field-bound', '');
    const name = (el.dataset.asciiField || 'plasma') as PresetName;
    const base = presets[name] ?? presets.plasma;
    const stillAttr = el.hasAttribute('data-field-still');
    const pointer = el.dataset.fieldPointer !== 'off' && !stillAttr;
    const strength = parseFloat(el.dataset.fieldStrength || '');
    const t0 = parseFloat(el.dataset.fieldT0 || '');
    // culls: data-field-hole="cx cy rx ry", data-field-skip-x="x0 x1" (fractions of the host)
    const hv = (el.dataset.fieldHole || '').trim().split(/\s+/).map(Number);
    const hole = hv.length === 4 && hv.every(Number.isFinite) ? { cx: hv[0], cy: hv[1], rx: hv[2], ry: hv[3] } : undefined;
    const sv = (el.dataset.fieldSkipX || '').trim().split(/\s+/).map(Number);
    const skipX = sv.length === 2 && sv.every(Number.isFinite) && sv[1] > sv[0] ? { x0: sv[0], x1: sv[1] } : undefined;
    const f = createField(el, {
      fn: pointer ? withPointer(base, parseFloat(el.dataset.fieldRadius || '') || 150, Number.isFinite(strength) ? strength : 0.6) : base,
      t0: Number.isFinite(t0) ? t0 : 0,
      size: parseFloat(el.dataset.fieldSize || '') || 14,
      fps: stillAttr ? 0 : parseFloat(el.dataset.fieldFps || '') || 24,
      pointer,
      ramp: el.dataset.fieldRamp || undefined,
      hole,
      skipX,
    });
    f.start();
  });
}
