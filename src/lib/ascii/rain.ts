/**
 * KAIRO // ASCII — rain over a slow liquid pool (the 404 scene).
 *
 * Glyph rain falls forever; for the first `settle` seconds it fills a pool
 * at the bottom, which then holds its level (no overflow) while its surface
 * rolls as a slow travelling wave (three low-frequency sines, < 1 row of
 * amplitude). Surface cells use '_' '~' '≈' by how far the liquid reaches
 * into the row, so the line moves smoothly between whole rows; the body
 * keeps the per-cell grain of the old rubble heap (stable, no re-rolls).
 * A few drops leave a tiny dim '.' splash for ~0.3s where they land.
 *
 * Looks like a createField() field (same ramp, the same 6 shades of
 * --red-lo → --red → --red-hi, same cell sizing), but draws its own canvas
 * because the surface needs glyphs and shades picked independently.
 *
 *   const pool = createRainPool(host, { settle: 2.4 });
 *   pool.start();   // shared field scheduler: paused offscreen and while the tab is hidden
 *
 * Reduced motion (or still: true): ONE frame, a full pool with a gentle
 * static wave line and no rain. No per-frame allocations: every buffer is
 * sized on resize.
 */
import { GLYPHS, onThemeChange, stillPage } from './motion';
import { fieldLoop, noise2, rand1, resolveColor } from './field';

export interface RainPoolOptions {
  /** glyph font size in CSS px (cell = 0.6*size × lineHeight*size). Default 14 */
  size?: number;
  lineHeight?: number;   // default 1.25
  fps?: number;          // default 24
  dpr?: number;          // DPR cap, default 1.5
  maxCells?: number;     // default 16000
  narrowScale?: number;  // ≤640px glyph size multiplier, default 1.2
  narrowMaxCells?: number; // default 6000
  /** seconds for the pool to fill. Default 2.4 */
  settle?: number;
  /** clock offset (s). >= settle starts with the pool already full. Default 0 */
  t0?: number;
  /** one still frame, no loop (also forced by stillPage()) */
  still?: boolean;
}

export interface RainPoolHandle {
  canvas: HTMLCanvasElement;
  start(): void;
  stop(): void;
  destroy(): void;
  /** draw one frame at time t (seconds); rain off draws the pool alone */
  renderOnce(t?: number, rain?: boolean): void;
}

const RAMP = GLYPHS.ramp;            // ' .:-=+*#%@' (same as the field)
const NR = RAMP.length;
const SET = [...RAMP, '_', '~', '≈'];
const G_DOT = 1, G_LOW = NR, G_MID = NR + 1, G_HIGH = NR + 2;
const SHADES = 6;
const TH = 0.06;
const TAU = Math.PI * 2;
const STREAK = 5;                    // rows of trail behind a drop head
const SPLASH = 0.3;                  // s

/** pool surface offset in rows: slow, small, travelling (max ≈ 0.72 rows). */
function wave(x: number, t: number): number {
  return 0.36 * Math.sin(TAU * (x / 560 - t / 9.5))
    + 0.24 * Math.sin(TAU * (x / 330 - t / 6.8) + 1.9)
    + 0.12 * Math.sin(TAU * (x / 190 + t / 11) + 4.2);
}

export function createRainPool(host: HTMLElement, opts: RainPoolOptions = {}): RainPoolHandle {
  const o = {
    size: 14, lineHeight: 1.25, fps: 24, dpr: 1.5, maxCells: 16000, narrowScale: 1.2, narrowMaxCells: 6000,
    settle: 2.4, t0: 0, still: false,
    ...(Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as RainPoolOptions),
  };
  const still = o.still || stillPage();
  const SETTLE = o.settle;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'ascii-field-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  host.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true })!;
  const atlas = document.createElement('canvas');
  const actx = atlas.getContext('2d')!;

  let cols = 0, rows = 0, cellW = 0, cwD = 1, chD = 1, dpr = 1, size = o.size;
  // per-cell buffer (row from the bottom × col): glyph | shade << 4, 0 = empty
  let cells = new Uint8Array(0);
  // per-column constants (set on resize) and per-frame scratch
  let finalH = new Float32Array(0), fillT0 = new Float32Array(0), fillDur = new Float32Array(0);
  let period = new Float32Array(0), phase = new Float32Array(0), bright = new Float32Array(0);
  let level = new Float32Array(0), surf = new Int16Array(0);
  let lastT = o.t0, lastRain = !still;

  function buildAtlas() {
    atlas.width = Math.max(1, cwD * SET.length);
    atlas.height = Math.max(1, chD * SHADES);
    actx.clearRect(0, 0, atlas.width, atlas.height);
    actx.font = `500 ${size * dpr}px "Geist Mono", ui-monospace, monospace`;
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    const stops = ['--red-lo', '--red', '--red-hi'].map((c) => resolveColor(actx, c));
    for (let s = 0; s < SHADES; s++) {
      const f = s / (SHADES - 1);
      const seg = Math.min(stops.length - 2, Math.floor(f * (stops.length - 1)));
      const lf = f * (stops.length - 1) - seg;
      const a = stops[seg], b = stops[seg + 1];
      actx.fillStyle = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * lf)).join(',')})`;
      for (let g = 1; g < SET.length; g++) actx.fillText(SET[g], g * cwD + cwD / 2, s * chD + chD / 2);
    }
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, o.dpr);
    const narrow = window.innerWidth <= 640;
    size = narrow ? o.size * o.narrowScale : o.size;
    if (!narrow && window.innerWidth > 1920) size *= window.innerWidth / 1920;
    const budget = narrow ? Math.min(o.maxCells, o.narrowMaxCells) : o.maxCells;
    while ((w / (size * 0.6)) * (h / (size * o.lineHeight)) > budget) size *= 1.12;
    cwD = Math.max(1, Math.round(size * 0.6 * dpr));
    chD = Math.max(1, Math.round(size * o.lineHeight * dpr));
    cellW = cwD / dpr;
    const cellH = chD / dpr;
    cols = Math.max(1, Math.ceil(w / cellW));
    rows = Math.max(1, Math.ceil(h / cellH));
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    if (cells.length !== cols * rows) cells = new Uint8Array(cols * rows);
    if (finalH.length !== cols) {
      finalH = new Float32Array(cols); fillT0 = new Float32Array(cols); fillDur = new Float32Array(cols);
      period = new Float32Array(cols); phase = new Float32Array(cols); bright = new Float32Array(cols);
      level = new Float32Array(cols); surf = new Int16Array(cols);
    }
    for (let c = 0; c < cols; c++) {
      const edge = Math.abs((c + 0.5) / cols - 0.5) * 2; // 0 centre → 1 edges
      // the old heap's mean profile (low under the copy, higher at the edges), smoothed into a liquid
      finalH[c] = Math.max(1, rows * (0.095 + 0.09 * edge * edge) + 1);
      // neighbouring columns start/finish filling together, so the rising surface stays coherent
      fillT0[c] = noise2(c * 0.06, 9.1) * 0.5;
      fillDur[c] = 1.2 + noise2(c * 0.05, 3.3) * 0.7;
      // rain: the same per-column streaks as before
      period[c] = 0.75 + rand1(c + 13) * 0.4;
      phase[c] = rand1(c + 999);
      bright[c] = 0.55 + rand1(c + 31) * 0.4;
    }
    buildAtlas();
  }

  const put = (c: number, fb: number, v: number) => {
    if (!(v > TH) || fb < 0 || fb >= rows) return;
    if (v > 0.9999) v = 0.9999;
    cells[fb * cols + c] = Math.max(1, Math.floor(v * NR)) | (Math.floor(v * SHADES) << 4);
  };

  function draw(t: number, rain: boolean) {
    lastT = t; lastRain = rain;
    cells.fill(0);
    // rain eases ~20% dimmer once the pool has filled: it keeps going, quietly
    const ease = Math.min(1, Math.max(0, (t - SETTLE) / 2));
    const gain = 1 - 0.2 * ease * ease * (3 - 2 * ease);

    // pass 1: pool body + surface
    for (let c = 0; c < cols; c++) {
      const k = Math.min(1, Math.max(0, (t - fillT0[c]) / fillDur[c]));
      const e = 1 - (1 - k) * (1 - k); // ease-out fill
      const wv = wave((c + 0.5) * cellW, t);
      const H = Math.max(0, (finalH[c] + wv) * e);
      level[c] = H;
      const s = Math.floor(H);
      surf[c] = s;
      const fl = finalH[c];
      for (let fb = 0; fb < s && fb < rows; fb++) {
        const grain = rand1(c * 131 + fb * 7919); // stable per cell: no re-rolls
        put(c, fb, Math.min(0.98, 0.18 + grain * 0.42 * (0.5 + fb / fl) + (fb === s - 1 ? 0.12 : 0)));
      }
      if (H > 0.15 && s < rows) {
        // how far the liquid reaches into the surface row picks the glyph:
        // '_' low → '~' → '≈' near the top; crests a shade brighter
        const f = H - s;
        const g = f < 0.34 ? G_LOW : f < 0.67 ? G_MID : G_HIGH;
        const sh = (g === G_LOW ? 2 : 3) + (wv > 0.3 ? 1 : 0);
        cells[s * cols + c] = g | (sh << 4);
      }
    }
    if (!rain) return blit();

    // pass 2: rain streaks (above the surface) + the odd splash
    for (let c = 0; c < cols; c++) {
      const P = period[c];
      const ph = t + phase[c] * P;
      const u = (ph % P) / P;
      const span = rows - level[c];
      const head = u * u * span; // accelerating, from the top edge down to the surface
      const s = surf[c];
      const vb = bright[c] * gain;
      for (let r = Math.max(0, Math.floor(head - STREAK)); r <= head && r < rows; r++) {
        const fb = rows - 1 - r;
        if (fb <= s) continue;
        const d = head - r;
        put(c, fb, (1 - d / STREAK) * vb);
      }
      // splash: ~3 in 10 drops, a dim '.' either side of where it landed, stepping out once
      const tau = u * P;
      if (t > 0.6 && tau < SPLASH && rand1(c * 7 + Math.floor(ph / P) * 131) < 0.3) {
        const off = tau < SPLASH * 0.45 ? 1 : 2;
        for (let side = -1; side <= 1; side += 2) {
          const nc = c + side * off;
          if (nc < 0 || nc >= cols) continue;
          const fb = surf[nc] + 1;
          if (fb >= rows || cells[fb * cols + nc]) continue;
          cells[fb * cols + nc] = G_DOT | (1 << 4);
        }
      }
    }
    blit();
  }

  function blit() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const H = canvas.height;
    for (let fb = 0; fb < rows; fb++) {
      const yD = H - (fb + 1) * chD; // bottom-aligned: the pool's floor row is never clipped
      const base = fb * cols;
      for (let c = 0; c < cols; c++) {
        const v = cells[base + c];
        if (!v) continue;
        ctx.drawImage(atlas, (v & 15) * cwD, (v >> 4) * chD, cwD, chD, c * cwD, yD, cwD, chD);
      }
    }
  }

  const stillT = SETTLE + 3.4;
  const lp = still ? null : fieldLoop(host, (t) => draw(t + o.t0, true), { fps: o.fps });
  const redraw = () => (still ? draw(stillT, false) : draw(lastT, lastRain));

  let pending = 0;
  const ro = new ResizeObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; resize(); if (!lp?.running) redraw(); });
  });
  ro.observe(host);
  const offTheme = onThemeChange(() => { buildAtlas(); if (!lp?.running) redraw(); });

  resize();
  document.fonts?.load(`500 ${o.size}px "Geist Mono"`, RAMP + '_~≈').then(() => { buildAtlas(); if (!lp?.running) redraw(); }).catch(() => {});
  redraw(); // paint now: no empty band before the first tick

  return {
    canvas,
    start() { if (lp) lp.start(); else redraw(); },
    stop() { lp?.stop(); },
    destroy() { lp?.destroy(); ro.disconnect(); offTheme(); canvas.remove(); },
    renderOnce(t = stillT, rain = false) { draw(t, rain); },
  };
}
