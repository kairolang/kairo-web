/**
 * KAIRO // ASCII - homepage hero scene.
 *
 * A real-time ASCII rasteriser: the Penrose tribar (penrose.ts, ray-cast per
 * cell), a wave lattice and a few depth particles are drawn into a monospace
 * cell grid, then each cell becomes a glyph from a luminance ramp
 * (" .:-=+*#%@") in a red shade. Glyphs are pre-rendered into an atlas once;
 * a frame is arithmetic over typed arrays + cheap blits.
 *
 * The dot_product.k source flows AROUND the triangle's live silhouette (and
 * stays out of its hole): every frame each grid row's free spans (outside
 * the figure, dilated) are computed and @chenglou/pretext lays the text into
 * them with layoutNextLineRange(), so the code reflows around the swaying
 * shape without any DOM measurement.
 *
 * Motion: the triangle holds the impossible view with a slow roll sway; the
 * pointer adds a small lean and a hair of tilt, and a small lens magnifies
 * and "sharpens" glyphs near it (ramp to ░▒▓█ blocks). Touch: lean only.
 *
 * Perf: runs through motion.loop() (paused offscreen + when document.hidden),
 * DPR <= 1.5, cell size grows if the grid exceeds the cell budget, the figure
 * is only cast inside its bbox, all hot-loop buffers are preallocated typed
 * arrays. Line strings are cached by cursor range. Reduced motion: one
 * composed still frame at the exact illusion (re-rendered on resize/theme
 * only).
 */
import { cssVar, finePointer, loop, onThemeChange, type Loop } from '../../../lib/ascii/motion';
import { createPenrose, type PenroseGrid } from './penrose';

type Pretext = typeof import('@chenglou/pretext');
type Prepared = ReturnType<Pretext['prepareWithSegments']>;
type Cursor = { segmentIndex: number; graphemeIndex: number };

export interface HeroSceneOptions {
  /** positioned element the canvas fills (the hero's top band) */
  host: HTMLElement;
  /** layout slot that holds the figure; the text wall flows inside its rows */
  stage: HTMLElement;
  /** copy column: lattice/particles are kept off it so copy sits on clean bg */
  copy?: HTMLElement | null;
  /** source text for the reflowing wall */
  text: string;
  /** play the ~550ms scan-print entrance */
  intro: boolean;
  /** render one still frame, no loop (reduced motion / calm) */
  still: boolean;
}

export interface HeroScene {
  destroy(): void;
}

/* ─── glyph table ──────────────────────────────────────────────── */
const RAMP = ' .:-=+*#%@';
const BLOCKS = ' ░▒▓█';
const GLYPHS: string[] = [' '];
const gi = (ch: string) => {
  let i = GLYPHS.indexOf(ch);
  if (i < 0) { i = GLYPHS.length; GLYPHS.push(ch); }
  return i;
};
const G_RAMP = [...RAMP].map(gi);       // 10, [0] = blank
const G_BLOCK = [...BLOCKS].map(gi);    // 5,  [0] = blank
const G_DASH = gi('-'), G_SLASH = gi('/'), G_BACK = gi('\\');
const G_DOT = gi('.'), G_MID = gi('·'), G_PLUS = gi('+');
const NOISE = [G_RAMP[3], G_RAMP[5], G_RAMP[6], G_RAMP[7], G_RAMP[8], G_RAMP[9]];

const SHADES = 8;
const STILL_T = 7.5;
const INTRO_S = 0.55;

function rgbOf(ctx: CanvasRenderingContext2D, c: string): [number, number, number] {
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

export function createHeroScene(o: HeroSceneOptions): HeroScene {
  const { host, stage, copy, still } = o;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-ascii-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  host.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true })!;
  const atlas = document.createElement('canvas');
  const actx = atlas.getContext('2d')!;

  /* grid state */
  let W = 0, Hh = 0, dpr = 1, size = 12;
  let cwD = 1, chD = 1, cellW = 1, cellH = 1, cols = 0, rows = 0;
  let mobile = false;
  let gbuf = new Uint8Array(0), sbuf = new Uint8Array(0), kind = new Uint8Array(0);
  let lbuf = new Float32Array(0), lens = new Uint8Array(0);
  let dimMask = new Uint8Array(0), textMask = new Uint8Array(0);
  let grid: PenroseGrid = { cols: 0, rows: 0, cellW: 1, cellH: 1, kind, lbuf, lens };
  // the tribar: rest centre (kcx, kcy) and px per unit (ks); its pivot in px
  // (pox, poy); vr: its rough radius (rest half-width / 1.5) for the text fill
  const pen = createPenrose();
  let kcx = 0, kcy = 0, ks = 100;
  let pox = 0, poy = 0, vr = 100;
  // wall region in cells
  let rc0 = 0, rc1 = 0, rr0 = 0, rr1 = 0;
  // particles: x, y, z, v, s
  const NP = 30;
  const parts = new Float32Array(NP * 5);
  for (let i = 0; i < NP; i++) {
    parts[i * 5] = Math.random() * 2 - 1;
    parts[i * 5 + 1] = Math.random() * 2 - 1;
    parts[i * 5 + 2] = Math.random() * 2 - 1;
    parts[i * 5 + 3] = 0.012 + Math.random() * 0.03;
    parts[i * 5 + 4] = Math.random();
  }
  let nParts = NP;

  /* text wall state */
  let pt: Pretext | null = null;
  let prepared: Prepared | null = null;
  let preparedFont = '';
  const lineCache = new Map<number, string>();
  const MAXIV = 4;
  let ivA = new Int16Array(0), ivN = new Uint8Array(0); // stored intervals per row [c0,c1)*MAXIV
  const tmpIv = new Int16Array(MAXIV * 2);
  const rowFree = new Uint8Array(1024);
  // Per-row segments (slot r*MAXIV + q). Each row starts from its own
  // anchored cursor, so re-laying out one row never rewrites the rows below.
  let segCol = new Int16Array(0), segLen = new Int16Array(0), segN = new Uint8Array(0);
  let segStr: string[] = [];
  let anchors: Cursor[] = [];
  let rowT = new Float32Array(0); // last commit time per row (s)
  const ROW_SHRINK_S = 0.35, ROW_GROW_S = 0.4; // <= ~3 text swaps / s per row
  let wallDirty = true;
  // drawn ink per cell (dead band against slow drift) + had-ink-last-frame flag
  let dsp = new Float32Array(0), cov = new Uint8Array(0);
  let textFill: CanvasGradient | string = 'rgba(99,99,107,.5)';

  /* pointer */
  let pX = -1e4, pY = -1e4, pInside = false, pTouch = false;
  let lx = -1e4, ly = -1e4, lensAmt = 0; // eased lens centre + strength
  let rotX = 0, rotY = 0;
  const fine = finePointer();
  const onMove = (e: PointerEvent) => { pX = e.clientX; pY = e.clientY; pInside = true; pTouch = e.pointerType === 'touch'; };
  const onLeave = () => { pInside = false; };
  if (!still) {
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
  }

  let lastT = still ? STILL_T : 0;
  let frameNo = 0;

  function buildAtlas() {
    atlas.width = Math.max(1, cwD * GLYPHS.length);
    atlas.height = Math.max(1, chD * SHADES);
    actx.clearRect(0, 0, atlas.width, atlas.height);
    actx.font = `500 ${size * dpr}px "Geist Mono", ui-monospace, monospace`;
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    const stops = ['--red-lo', '--red', '--red-hi'].map((c) => rgbOf(actx, c));
    for (let s = 0; s < SHADES; s++) {
      const f = s / (SHADES - 1);
      const seg = Math.min(stops.length - 2, Math.floor(f * (stops.length - 1)));
      const lf = f * (stops.length - 1) - seg;
      const a = stops[seg], b = stops[seg + 1];
      const alpha = 0.22 + 0.78 * f;
      actx.fillStyle = `rgba(${Math.round(a[0] + (b[0] - a[0]) * lf)},${Math.round(a[1] + (b[1] - a[1]) * lf)},${Math.round(a[2] + (b[2] - a[2]) * lf)},${alpha.toFixed(3)})`;
      for (let g = 1; g < GLYPHS.length; g++) actx.fillText(GLYPHS[g], g * cwD + cwD / 2, s * chD + chD / 2 + 0.5);
    }
    // text wall fill: warmer near the figure, fading to the dim decoration grey
    const t2 = rgbOf(ctx, '--text-2');
    const t3 = rgbOf(ctx, '--text-3');
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const g = ctx.createRadialGradient(kcx, kcy, vr * 1.1, kcx, kcy, Math.max(vr * 2.8, 220));
    g.addColorStop(0, `rgba(${t2[0]},${t2[1]},${t2[2]},${light ? 0.5 : 0.42})`);
    g.addColorStop(1, `rgba(${t3[0]},${t3[1]},${t3[2]},${light ? 0.4 : 0.38})`);
    textFill = g;
  }

  function measure() {
    W = host.clientWidth; Hh = host.clientHeight;
    mobile = W < 960;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    size = W >= 960 ? 12 : W >= 560 ? 11 : 10;
    while ((W / (size * 0.6)) * (Hh / (size * 1.25)) > 24000) size += 1;
    cwD = Math.max(1, Math.round(size * 0.6 * dpr));
    chD = Math.max(1, Math.round(size * 1.25 * dpr));
    cellW = cwD / dpr; cellH = chD / dpr;
    cols = Math.ceil(W / cellW); rows = Math.ceil(Hh / cellH);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(Hh * dpr));
    const n = cols * rows;
    if (gbuf.length !== n) {
      gbuf = new Uint8Array(n); sbuf = new Uint8Array(n); kind = new Uint8Array(n);
      lbuf = new Float32Array(n); lens = new Uint8Array(n);
      dimMask = new Uint8Array(n); textMask = new Uint8Array(n);
      dsp = new Float32Array(n); cov = new Uint8Array(n);
    }
    grid = { cols, rows, cellW, cellH, kind, lbuf, lens };
    ivA = new Int16Array(rows * MAXIV * 2); ivN = new Uint8Array(rows);
    segCol = new Int16Array(rows * MAXIV); segLen = new Int16Array(rows * MAXIV); segN = new Uint8Array(rows);
    segStr = new Array(rows * MAXIV).fill('');
    rowT = new Float32Array(rows);

    const hr = host.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const sx = sr.left - hr.left, sy = sr.top - hr.top;
    measurePenrose(sx, sy, sr, hr);
    // the wall: the stage rows; desktop runs from the stage to the right edge (full bleed)
    rc0 = Math.max(1, Math.floor((mobile ? 0 : sx) / cellW) + (mobile ? 1 : 0));
    rc1 = Math.min(cols - 1, Math.floor((mobile ? W : W - 8) / cellW) - 1);
    rr0 = Math.max(0, Math.ceil(sy / cellH));
    rr1 = Math.min(rows, Math.floor((sy + sr.height) / cellH) - 2);

    // keep the background lattice/particles off the copy column
    dimMask.fill(0);
    if (copy) {
      const cr = copy.getBoundingClientRect();
      const c0 = Math.max(0, Math.floor((cr.left - hr.left - 16) / cellW));
      const c1 = Math.min(cols, Math.ceil((cr.right - hr.left + 16) / cellW));
      const r0 = Math.max(0, Math.floor((cr.top - hr.top - 12) / cellH));
      const r1 = Math.min(rows, Math.ceil((cr.bottom - hr.top + 12) / cellH));
      for (let r = r0; r < r1; r++) dimMask.fill(1, r * cols + c0, r * cols + c1);
    }

    nParts = mobile ? 14 : NP;
    wallDirty = true;
    lineCache.clear();
    buildAtlas();
    ensurePrepared();
  }

  /**
   * Size + place the tribar: on desktop its rest centre sits at 43% of the
   * wall (stage to right edge) with a >= 11-cell text column beside its base
   * at rest, and nothing the motion can reach (sway + lean roll, pointer
   * tilt; a few px past the rest bbox) touches the copy column, the right
   * edge or the stage's top/bottom. Two passes: the bar thickness follows
   * the final size.
   */
  function measurePenrose(sx: number, sy: number, sr: DOMRect, hr: DOMRect) {
    let bar = 0.12;
    for (let pass = 0; pass < 2; pass++) {
      pen.setBar(bar);
      const { rest, any } = pen.extents();
      const rcx = (rest.x0 + rest.x1) / 2, rcy = (rest.y0 + rest.y1) / 2;
      const restHW = (rest.x1 - rest.x0) / 2;
      const reachL = rcx - any.x0, reachR = any.x1 - rcx;
      const reachV = Math.max(rcy - any.y0, any.y1 - rcy);
      kcx = sx + sr.width / 2; kcy = sy + sr.height / 2;
      // base: rest width ~0.9 x the stage's short side
      let k = (Math.min(sr.width, sr.height) * 0.9) / (2 * restHW);
      if (!mobile) {
        const KC_AT = 0.43;
        const wallL = sx, wallR = W - 8, wallW = wallR - wallL;
        kcx = wallL + wallW * KC_AT;
        // >= 11 cells on its left: the triangle is only that wide on its
        // bottom rows (the wall widens up its slope)
        k = Math.min(k, (kcx - wallL - 11 * cellW) / restHW, (wallR - kcx - 4 * cellW) / reachR);
        if (copy) {
          const copyR = copy.getBoundingClientRect().right - hr.left;
          k = Math.min(k, (kcx - copyR - 2 * cellW) / reachL);
        }
      } else {
        k = Math.min(k, (W / 2 - 4 - 2 * cellW) / Math.max(reachL, reachR));
      }
      // stay inside the stage band, clear of the caption row
      k = Math.max(60, Math.min(k, (sr.height / 2 - 2 * cellH) / reachV));
      if (mobile) {
        const slack = W - 8 - kcx - reachR * k - 6 * cellW;
        if (slack > 0) kcx += Math.min(W * 0.05, slack);
      }
      ks = k;
      pox = kcx - rcx * ks; poy = kcy - rcy * ks;
      vr = (restHW * ks) / 1.5;
      // the logo's bars are slimmer, but a face needs ~2 text rows to read
      // as a face: thickness follows the on-screen size (bottom bar faces ~2.4 rows)
      if (pass === 0) bar = Math.min(0.15, Math.max(0.1, (2.4 * cellH) / (0.707 * ks)));
    }
  }

  function fontStr() { return `400 ${size}px "Geist Mono"`; }

  function ensurePrepared() {
    if (!pt) return;
    const f = fontStr();
    if (f === preparedFont && prepared) return;
    try {
      prepared = pt.prepareWithSegments(o.text, f);
      preparedFont = f;
      lineCache.clear();
      wallDirty = true;
    } catch { prepared = null; }
  }

  /* ─── rasterisers ─────────────────────────────────────────────── */
  function rasterLattice(t: number) {
    const LROWS = mobile ? 4 : 6;
    const wy = Hh * 0.985;
    const spread = Math.min(Hh * 0.3, mobile ? 200 : 300);
    const amp = Math.min(Hh * 0.05, 40);
    const wScale = W * 0.62;
    for (let r = 0; r < LROWS; r++) {
      const z = r / (LROWS - 1);
      const f = 1.6 / (1.6 + z * 2.1);
      const sc = wScale * (1 + z * 1.6) * f;
      const shade = Math.max(0, Math.round((1 - z) * 3));
      let prev = -1;
      for (let c = -1; c < cols; c++) {
        const x = ((c + 1.5) * cellW - W / 2) / sc;
        const wave = Math.sin(x * 7 + t * 0.33 + z * 2.2) * 0.45 + Math.cos(x * 13 - t * 0.22 + z * 4) * 0.22;
        const rf = (wy - z * spread + wave * amp * f) / cellH;
        if (c >= 0) {
          const row = rf | 0;
          if (row >= 0 && row < rows) {
            const i = row * cols + c;
            if (!kind[i] && !dimMask[i] && !nearFigure(row, c)) {
              const d = rf - prev;
              gbuf[i] = d > 0.55 ? G_BACK : d < -0.55 ? G_SLASH : G_DASH;
              sbuf[i] = shade; kind[i] = 1;
            }
          }
        }
        prev = rf;
      }
    }
  }

  /** figure cell within a row / 2 columns? (a clear margin round the triangle, so
   *  the lattice's dashes never run on from its base or edges) */
  function nearFigure(r: number, c: number): boolean {
    for (let rr = r - 1; rr <= r + 1; rr++) {
      if (rr < 0 || rr >= rows) continue;
      const b = rr * cols;
      for (let cc = Math.max(0, c - 2), ce = Math.min(cols - 1, c + 2); cc <= ce; cc++) if (kind[b + cc] >= 2) return true;
    }
    return false;
  }

  function rasterParticles(dt: number, cy: number, sy: number) {
    for (let k = 0; k < nParts; k++) {
      const o5 = k * 5;
      if (!still) {
        parts[o5 + 1] -= parts[o5 + 3] * dt;
        if (parts[o5 + 1] < -1.1) { parts[o5 + 1] = 1.1; parts[o5] = Math.random() * 2 - 1; }
      }
      const x = parts[o5], y = parts[o5 + 1], z = parts[o5 + 2], s = parts[o5 + 4];
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const f = 2.6 / (2.6 + z1);
      const col = ((W * 0.5 + x1 * W * 0.5 * f) / cellW) | 0;
      const row = ((Hh * 0.5 + y * Hh * 0.55 * f) / cellH) | 0;
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      const i = row * cols + col;
      if (kind[i] || dimMask[i]) continue;
      gbuf[i] = s > 0.88 ? G_PLUS : s > 0.45 ? G_MID : G_DOT;
      sbuf[i] = s > 0.88 ? 3 : 1;
      kind[i] = 1;
    }
  }

  /* ─── text wall (pretext) ─────────────────────────────────────── */
  function computeIntervals(r: number, out: Int16Array): number {
    // free = inside region and no figure cell within +/-PADX columns on rows r-1..r+1
    const PADX = 3;
    const span = rc1 - rc0;
    if (span <= 0) return 0;
    rowFree.fill(1, 0, Math.min(rowFree.length, span));
    for (let rr = r - 1; rr <= r + 1; rr++) {
      if (rr < 0 || rr >= rows) continue;
      const base = rr * cols;
      for (let c = rc0 - PADX; c < rc1 + PADX; c++) {
        if (c < 0 || c >= cols || kind[base + c] < 2) continue; // 2 ink, 3 tribar hole
        const a = Math.max(0, c - PADX - rc0), b = Math.min(span, c + PADX + 1 - rc0);
        for (let q = a; q < b; q++) rowFree[q] = 0;
      }
    }
    let n = 0, start = -1;
    for (let q = 0; q <= span; q++) {
      const free = q < span && rowFree[q] === 1;
      if (free && start < 0) start = q;
      else if (!free && start >= 0) {
        // quantise to even columns so 1-cell silhouette wobble doesn't reflow
        const a = rc0 + ((start + 1) & ~1), b = rc0 + (q & ~1);
        if (b - a >= 10 && n < MAXIV) { out[n * 2] = a; out[n * 2 + 1] = b; n++; }
        start = -1;
      }
    }
    return n;
  }

  function updateWall(t: number) {
    if (!pt || !prepared) return;
    // Full layout only on resize / font / text change. Otherwise each row is
    // independent (anchored start cursor) and rate-limited: an intrusion of
    // the figure into a row's text is fixed at once by trimming that row's
    // tail; real re-flows of a row happen at most every ~0.35-0.4 s.
    const full = wallDirty;
    if (full) { computeAnchors(); textMask.fill(0); segN.fill(0); }
    for (let r = rr0; r < rr1; r++) {
      const n = computeIntervals(r, tmpIv);
      const base = r * MAXIV * 2;
      if (!full) {
        let same = n === ivN[r];
        if (same) {
          for (let q = 0; q < n * 2; q++) {
            // hysteresis: ignore <=2-cell boundary drift
            if (Math.abs(tmpIv[q] - ivA[base + q]) > 2) { same = false; break; }
          }
        }
        const unsafe = rowUnsafe(r);
        if (same && !unsafe) continue;
        const since = t - rowT[r];
        if (since >= 0 && since < (unsafe ? ROW_SHRINK_S : ROW_GROW_S)) {
          if (unsafe) trimRow(r);
          continue;
        }
      }
      ivN[r] = n;
      for (let q = 0; q < n * 2; q++) ivA[base + q] = tmpIv[q];
      layoutRow(r);
      rowT[r] = t;
    }
    wallDirty = false;
  }

  /** does row r's drawn text overlap a figure cell? */
  function rowUnsafe(r: number): boolean {
    const rb = r * cols;
    for (let q = 0; q < segN[r]; q++) {
      const k = r * MAXIV + q, a = segCol[k], e = a + segLen[k];
      for (let c = a; c < e; c++) if (kind[rb + c] >= 2) return true;
    }
    return false;
  }

  /** local fix: cut row r's segments back (at a word gap) to clear the figure */
  function trimRow(r: number) {
    const rb = r * cols;
    for (let q = 0; q < segN[r]; q++) {
      const k = r * MAXIV + q, a = segCol[k], len = segLen[k];
      let hit = -1;
      for (let c = a; c < a + len; c++) if (kind[rb + c] >= 2) { hit = c; break; }
      if (hit < 0) continue;
      const str = segStr[k];
      let cut = Math.min(str.length, hit - a - 1);
      if (cut > 0 && cut < str.length) {
        const sp = str.lastIndexOf(' ', cut);
        if (sp > 0) cut = sp;
      }
      if (cut < 2) cut = 0;
      textMask.fill(0, rb + a + cut, rb + a + len);
      segLen[k] = cut;
      segStr[k] = cut ? str.slice(0, cut) : '';
    }
  }

  /** per-row start cursors: the text laid out at the full (unobstructed) wall width */
  function computeAnchors() {
    const p = pt!, prep = prepared!;
    const maxW = ((rc1 - rc0) & ~1) * size * 0.6;
    anchors = new Array(rows);
    let cur: Cursor = { segmentIndex: 0, graphemeIndex: 0 };
    for (let r = rr0; r < rr1; r++) {
      anchors[r] = cur;
      if (maxW <= 0) continue;
      let range = p.layoutNextLineRange(prep, maxW, cur);
      if (!range) { cur = { segmentIndex: 0, graphemeIndex: 0 }; anchors[r] = cur; range = p.layoutNextLineRange(prep, maxW, cur); }
      if (range) cur = range.end;
    }
  }

  function layoutRow(r: number) {
    const p = pt!, prep = prepared!;
    const charW = size * 0.6;
    const rb = r * cols, sb = r * MAXIV;
    for (let q = 0; q < segN[r]; q++) textMask.fill(0, rb + segCol[sb + q], rb + segCol[sb + q] + segLen[sb + q]);
    segN[r] = 0;
    let cur: Cursor = anchors[r] || { segmentIndex: 0, graphemeIndex: 0 };
    const base = r * MAXIV * 2;
    for (let q = 0; q < ivN[r]; q++) {
      const a = ivA[base + q * 2], b = ivA[base + q * 2 + 1];
      const maxW = (b - a) * charW;
      let range = p.layoutNextLineRange(prep, maxW, cur);
      if (!range) { cur = { segmentIndex: 0, graphemeIndex: 0 }; range = p.layoutNextLineRange(prep, maxW, cur); }
      if (!range) continue;
      // never split a word into a narrow slot: leave the slot to the field
      // and let the whole word take the next one
      if (range.end.graphemeIndex > 0 && b - a < 14) continue;
      const s0 = range.start, e0 = range.end;
      const key = ((s0.segmentIndex * 64 + Math.min(63, s0.graphemeIndex)) * 32768 + e0.segmentIndex) * 64 + Math.min(63, e0.graphemeIndex);
      let str = lineCache.get(key);
      if (str === undefined) {
        str = p.materializeLineRange(prep, range).text;
        if (lineCache.size > 6000) lineCache.clear();
        lineCache.set(key, str);
      }
      cur = e0;
      const len = Math.min(b - a, Math.ceil(range.width / charW));
      const k = sb + segN[r]++;
      segCol[k] = a; segLen[k] = len; segStr[k] = str;
      textMask.fill(1, rb + a, rb + a + len);
    }
  }

  /* ─── frame ───────────────────────────────────────────────────── */
  function render(t: number, dt: number) {
    lastT = t;
    frameNo++;
    kind.fill(0);
    const ay = t * 0.12 + rotY;
    pen.pose(t, still, rotY, rotX);
    pen.raster(grid, pox, poy, ks, lx, ly, lensAmt, mobile ? 60 : 92);
    rasterLattice(t);
    rasterParticles(dt, Math.cos(ay * 0.6), Math.sin(ay * 0.6));
    updateWall(t);

    // intro: a print head sweeps down; rows below it are blank, rows at it are noise
    const sweep = o.intro && !still ? Math.min(1, t / INTRO_S) * (rows + 4) : 1e9;
    // still / re-measure frames draw the raw ink; live frames keep a dead band
    const direct = still || dt === 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rMax = Math.min(rows, Math.ceil(sweep));
    for (let r = 0; r < rMax; r++) {
      const head = sweep - r < 3;
      const base = r * cols, dy = r * chD;
      for (let c = 0; c < cols; c++) {
        const i = base + c;
        const k = kind[i];
        let g: number, s: number;
        // figure ink e (<0: not a figure glyph this frame). The tribar's ink
        // is exact (ray-cast, no sampling beat), so no easing; a small dead
        // band stops a glyph toggling between neighbours on slow drift
        let e = -1;
        if (k === 2) {
          const v = lbuf[i];
          const dd = v - dsp[i];
          if (direct || !cov[i] || dd > 0.045 || dd < -0.045) dsp[i] = v;
          cov[i] = 1; e = dsp[i];
        } else cov[i] = 0;
        if (e >= 0) {
          if (lens[i]) { const b = e * e * e; g = G_BLOCK[1 + ((b * 3.999) | 0)]; }
          else g = G_RAMP[1 + ((e * 9) | 0)];
          s = 2 + ((e * (SHADES - 2)) | 0);
        } else if (k === 1 && !textMask[i]) {
          g = gbuf[i]; s = sbuf[i];
        } else if (k === 2 && head) {
          g = 0; s = 0;
        } else continue;
        if (head) { g = NOISE[(i * 7 + frameNo * 13) % NOISE.length]; s = SHADES - 2; }
        ctx.drawImage(atlas, g * cwD, s * chD, cwD, chD, c * cwD, dy, cwD, chD);
      }
    }

    if (pt && prepared && rr1 > rr0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = fontStr();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = textFill;
      const rLim = Math.min(rr1, sweep - 3);
      for (let r = rr0; r < rLim; r++) {
        const y = (r + 0.5) * cellH + 0.5;
        for (let q = 0; q < segN[r]; q++) {
          const k = r * MAXIV + q;
          if (segLen[k] > 0) ctx.fillText(segStr[k], segCol[k] * cellW, y);
        }
      }
    }
  }

  let lp: Loop | null = null;
  const tick = (t: number, dt: number) => {
    // pointer: one rect read per frame, before any writes
    const hr = host.getBoundingClientRect();
    const mx = pX - hr.left, my = pY - hr.top;
    const inside = pInside && mx >= 0 && my >= 0 && mx <= hr.width && my <= hr.height;
    const k = Math.min(1, dt * 3.2);
    const tx = inside ? ((mx - kcx) / Math.max(1, W)) * 1.5 : 0;
    const ty = inside ? ((my - kcy) / Math.max(1, Hh)) * 1.0 : 0;
    rotY += (tx - rotY) * k;
    rotX += (ty - rotX) * k;
    const lensOn = inside && fine && !pTouch;
    if (lensOn) {
      if (lx < -1e3) { lx = mx; ly = my; }
      const kl = Math.min(1, dt * 14);
      lx += (mx - lx) * kl; ly += (my - ly) * kl;
    }
    lensAmt += ((lensOn ? 1 : 0) - lensAmt) * Math.min(1, dt * 6);
    render(t, dt);
  };

  let pending = 0;
  const ro = new ResizeObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      measure();
      if (still || !lp?.running) render(lastT, 0);
    });
  });
  ro.observe(host);
  ro.observe(stage);
  const offTheme = onThemeChange(() => { buildAtlas(); if (still || !lp?.running) render(lastT, 0); });

  measure();

  // Geist Mono first (atlas + exact text metrics), then pretext (lazy chunk)
  const fontReady = document.fonts
    ? document.fonts.load(`400 ${size}px "Geist Mono"`, 'fn dot(a: [T]) -> T {}@#%░▒▓█').catch(() => [])
    : Promise.resolve([]);
  fontReady.then(() => {
    buildAtlas();
    if (still) render(STILL_T, 0);
    return import('@chenglou/pretext');
  }).then((mod) => {
    pt = mod;
    ensurePrepared();
    if (still || !lp?.running) render(lastT, 0);
  }).catch(() => { /* no pretext: the figure still renders */ });

  if (still) render(STILL_T, 0);
  else { lp = loop(host, tick, { fps: mobile ? 24 : 30 }); lp.start(); }

  return {
    destroy() {
      lp?.destroy(); ro.disconnect(); offTheme();
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      canvas.remove();
    },
  };
}
