/**
 * KAIRO // ASCII — homepage hero scene.
 *
 * A real-time ASCII rasteriser: a (2,3) torus knot tube, a wave lattice and a
 * few depth particles are projected into a monospace cell grid with a
 * z-buffer + Lambert/Blinn shading, then each cell becomes a glyph from a
 * luminance ramp (" .:-=+*#%@") in a red shade. Glyphs are pre-rendered into
 * an atlas once; a frame is arithmetic over typed arrays + cheap blits.
 *
 * The dot_product.k source flows AROUND the knot's live silhouette: every
 * frame each grid row's free spans (outside the knot, dilated) are computed
 * and @chenglou/pretext lays the text into them with layoutNextLineRange(),
 * so the code reflows around the rotating shape without any DOM measurement.
 *
 * Pointer: the knot leans toward the cursor, and a small lens magnifies and
 * "sharpens" glyphs near it (ramp → ░▒▓█ blocks). Touch: lean only.
 *
 * Perf: runs through motion.loop() (paused offscreen + when document.hidden),
 * DPR ≤ 1.5, cell size grows if the grid exceeds the cell budget, sample count
 * scales with the knot's on-screen size, all hot-loop buffers are preallocated
 * typed arrays. Line strings are cached by cursor range. Reduced motion:
 * one composed still frame (re-rendered on resize/theme only).
 */
import { cssVar, finePointer, loop, onThemeChange, type Loop } from '../../../lib/ascii/motion';

type Pretext = typeof import('@chenglou/pretext');
type Prepared = ReturnType<Pretext['prepareWithSegments']>;
type Cursor = { segmentIndex: number; graphemeIndex: number };

export interface HeroSceneOptions {
  /** positioned element the canvas fills (the hero's top band) */
  host: HTMLElement;
  /** layout slot that holds the knot; the text wall flows inside its rows */
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
const TUBE = 0.27;
const INTRO_S = 0.55;

/* knot geometry */
const CAM_D = 3.4;
const F_MIN = CAM_D / (CAM_D + 1.05);
const F_MAX = CAM_D / (CAM_D - 1.05);
// light (surface → light), normalised; and Blinn half-vector with view (0,0,-1)
const L = norm3(-0.5, -0.62, -0.6);
const H = norm3(L[0], L[1], L[2] - 1);

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

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

/** Sample a tube around the (2,3) torus knot. Rotation-minimising frame. */
function buildKnot(nt: number, nm: number, tube: number) {
  const n = nt * nm;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const R = 1, r = 0.45, h = 1e-3;
  const cx = (t: number) => (R + r * Math.cos(3 * t)) * Math.cos(2 * t);
  const cy = (t: number) => (R + r * Math.cos(3 * t)) * Math.sin(2 * t);
  const cz = (t: number) => r * Math.sin(3 * t) * 1.7;
  let nx = 0, ny = 0, nz = 0;
  let k = 0;
  for (let i = 0; i < nt; i++) {
    const t = (i / nt) * Math.PI * 2;
    const px = cx(t), py = cy(t), pz = cz(t);
    let tx = cx(t + h) - cx(t - h), ty = cy(t + h) - cy(t - h), tz = cz(t + h) - cz(t - h);
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    if (i === 0) {
      // any vector perpendicular to T
      nx = -ty; ny = tx; nz = 0;
      if (Math.hypot(nx, ny) < 1e-3) { nx = 1; ny = 0; nz = 0; }
    }
    // transport previous normal: remove its T component
    const d = nx * tx + ny * ty + nz * tz;
    nx -= d * tx; ny -= d * ty; nz -= d * tz;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // B = T × N
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const off = (i & 1) * (Math.PI / nm); // stagger rings for even coverage
    for (let j = 0; j < nm; j++, k += 3) {
      const a = (j / nm) * Math.PI * 2 + off;
      const ca = Math.cos(a), sa = Math.sin(a);
      const ux = nx * ca + bx * sa, uy = ny * ca + by * sa, uz = nz * ca + bz * sa;
      N[k] = ux; N[k + 1] = uy; N[k + 2] = uz;
      P[k] = px + ux * tube; P[k + 1] = py + uy * tube; P[k + 2] = pz + uz * tube;
    }
  }
  return { P, N, n };
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
  let zbuf = new Float32Array(0), lbuf = new Float32Array(0), lens = new Uint8Array(0);
  let dimMask = new Uint8Array(0), textMask = new Uint8Array(0);
  // knot
  let knot = buildKnot(8, 4, 0.2);
  let kcx = 0, kcy = 0, ks = 100;
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
  const MAXSEG = 900;
  const segCol = new Int16Array(MAXSEG), segRow = new Int16Array(MAXSEG), segLen = new Int16Array(MAXSEG);
  const segStr: string[] = new Array(MAXSEG).fill('');
  let nSeg = 0;
  let wallDirty = true;
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
    // text wall fill: warmer near the knot, fading to the dim decoration grey
    const t2 = rgbOf(ctx, '--text-2');
    const t3 = rgbOf(ctx, '--text-3');
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const g = ctx.createRadialGradient(kcx, kcy, ks * 1.1, kcx, kcy, Math.max(ks * 2.8, 220));
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
      zbuf = new Float32Array(n); lbuf = new Float32Array(n); lens = new Uint8Array(n);
      dimMask = new Uint8Array(n); textMask = new Uint8Array(n);
    }
    ivA = new Int16Array(rows * MAXIV * 2); ivN = new Uint8Array(rows);

    const hr = host.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const sx = sr.left - hr.left, sy = sr.top - hr.top;
    kcx = sx + sr.width / 2; kcy = sy + sr.height / 2;
    ks = Math.min(sr.width, sr.height) * (mobile ? 0.27 : 0.3);
    if (!mobile) {
      // Clearly LEFT of the wall's centre (knot centre at KC_AT of the wall,
      // which runs from the stage to the right edge), sized so the wall keeps
      // a readable column on the knot's left: ≥ 13 cells (~10 chars + the
      // 3-cell flow padding) at the resting half-width (≈ KTYP·ks, the still
      // frame). As it turns, the silhouette swings wider for a while
      // (≤ KX·ks incl. tube, perspective and lean), which squeezes that
      // column on some rows but never reaches the copy column.
      const KX = 1.94, KTYP = 1.5, KC_AT = 0.43;
      const wallL = sx, wallR = W - 8, wallW = wallR - wallL;
      const leftCol = 13 * cellW;
      kcx = wallL + wallW * KC_AT;
      ks = Math.min(ks, (kcx - wallL - leftCol) / KTYP, (wallR - kcx - 4 * cellW) / KX);
      if (copy) {
        const copyR = copy.getBoundingClientRect().right - hr.left;
        ks = Math.min(ks, (kcx - copyR - 2 * cellW) / KX);
      }
      ks = Math.max(60, ks);
    } else {
      ks = Math.min(ks, (W / 2 - 4) / 2.1 * 1.12);
      ks = Math.max(60, ks);
      // tablets have room for a slight right lean too; phones stay centred
      const slack = W - 8 - kcx - 2.0 * ks - 6 * cellW;
      if (slack > 0) kcx += Math.min(W * 0.05, slack);
    }
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

    // knot sample density follows its on-screen size
    const nt = Math.round(Math.min(1100, Math.max(480, ks * 6)));
    const nm = Math.round(Math.min(32, Math.max(16, ks * 0.2)));
    if (knot.n !== nt * nm) knot = buildKnot(nt, nm, TUBE);
    nParts = mobile ? 14 : NP;
    wallDirty = true;
    lineCache.clear();
    buildAtlas();
    ensurePrepared();
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
            if (!kind[i] && !dimMask[i]) {
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

  function rasterKnot(t: number) {
    const ay = t * 0.12 + rotY;
    const ax = 0.55 + Math.sin(t * 0.05) * 0.16 + rotX;
    const cyv = Math.cos(ay), syv = Math.sin(ay), cxv = Math.cos(ax), sxv = Math.sin(ax);
    const P = knot.P, N = knot.N, n = knot.n;
    const invW = 1 / cellW, invH = 1 / cellH;
    const useLens = lensAmt > 0.02;
    const LR = mobile ? 60 : 92, LR2 = LR * LR;
    const lxs = lx, lys = ly, la = lensAmt;
    const [Lx, Ly, Lz] = L; const [Hx, Hy, Hz] = H;
    const fspan = 1 / (F_MAX - F_MIN);
    for (let k = 0, j = 0; j < n; j++, k += 3) {
      // rotate normal first: cull back faces early
      const nx0 = N[k], ny0 = N[k + 1], nz0 = N[k + 2];
      const nx1 = nx0 * cyv + nz0 * syv, nz1 = -nx0 * syv + nz0 * cyv;
      const ny2 = ny0 * cxv - nz1 * sxv, nz2 = ny0 * sxv + nz1 * cxv;
      if (nz2 > 0.18) continue;
      const x0 = P[k], y0 = P[k + 1], z0 = P[k + 2];
      const x1 = x0 * cyv + z0 * syv, z1 = -x0 * syv + z0 * cyv;
      const y2 = y0 * cxv - z1 * sxv, z2 = y0 * sxv + z1 * cxv;
      const f = CAM_D / (CAM_D + z2);
      let px = kcx + x1 * ks * f, py = kcy + y2 * ks * f;
      let lk = 0;
      if (useLens) {
        const dx = px - lxs, dy = py - lys, d2 = dx * dx + dy * dy;
        if (d2 < LR2) {
          lk = (1 - d2 / LR2) * la;
          const m = 1 + 0.07 * lk * lk; // gentle bulge; more would open gaps
          px = lxs + dx * m; py = lys + dy * m;
        }
      }
      const col = (px * invW) | 0, row = (py * invH) | 0;
      if (px < 0 || col >= cols || py < 0 || row >= rows) continue;
      const i = row * cols + col;
      if (f <= zbuf[i]) continue;
      zbuf[i] = f;
      const diff = Math.max(0, nx1 * Lx + ny2 * Ly + nz2 * Lz);
      let hs = Math.max(0, nx1 * Hx + ny2 * Hy + nz2 * Hz);
      hs *= hs; hs *= hs; hs *= hs; hs *= hs; // ^16
      const near = (f - F_MIN) * fspan;
      let v = (0.12 + 0.72 * diff + 0.5 * hs) * (0.55 + 0.45 * near) + lk * 0.08;
      if (v > 0.999) v = 0.999;
      v = 1 - (1 - v) * (1 - v); // lift mids: denser glyphs, solid silhouette
      lbuf[i] = v;
      // dithered lens edge (stable per cell) so there is no hard ring
      lens[i] = lk > 0.3 + 0.5 * (((i * 2654435761) >>> 0) / 4294967296) ? 1 : 0;
      kind[i] = 2;
    }
  }

  /* ─── text wall (pretext) ─────────────────────────────────────── */
  function computeIntervals(r: number, out: Int16Array): number {
    // free = inside region and no knot cell within ±PADX columns on rows r-1..r+1
    const PADX = 3;
    const span = rc1 - rc0;
    if (span <= 0) return 0;
    rowFree.fill(1, 0, Math.min(rowFree.length, span));
    for (let rr = r - 1; rr <= r + 1; rr++) {
      if (rr < 0 || rr >= rows) continue;
      const base = rr * cols;
      for (let c = rc0 - PADX; c < rc1 + PADX; c++) {
        if (c < 0 || c >= cols || kind[base + c] !== 2) continue;
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
        if (b - a >= 6 && n < MAXIV) { out[n * 2] = a; out[n * 2 + 1] = b; n++; }
        start = -1;
      }
    }
    return n;
  }

  function updateWall() {
    if (!pt || !prepared) return;
    let changed = wallDirty;
    for (let r = rr0; r < rr1; r++) {
      const n = computeIntervals(r, tmpIv);
      const base = r * MAXIV * 2;
      let same = n === ivN[r];
      if (same) {
        for (let q = 0; q < n * 2; q++) {
          // hysteresis: ignore ≤2-cell boundary drift
          if (Math.abs(tmpIv[q] - ivA[base + q]) > 2) { same = false; break; }
        }
      }
      if (same) {
        // still safe? stored span must not now intersect the knot
        for (let q = 0; q < n && same; q++) {
          const a = ivA[base + q * 2], b = ivA[base + q * 2 + 1], rb = r * cols;
          for (let c = a; c < b; c++) if (kind[rb + c] === 2) { same = false; break; }
        }
      }
      if (!same) {
        ivN[r] = n;
        for (let q = 0; q < n * 2; q++) ivA[base + q] = tmpIv[q];
        changed = true;
      }
    }
    if (!changed) return;
    wallDirty = false;
    layoutWall();
  }

  function layoutWall() {
    const p = pt!, prep = prepared!;
    const charW = size * 0.6;
    let cur: Cursor = { segmentIndex: 0, graphemeIndex: 0 };
    nSeg = 0;
    textMask.fill(0);
    for (let r = rr0; r < rr1 && nSeg < MAXSEG; r++) {
      const base = r * MAXIV * 2;
      for (let q = 0; q < ivN[r] && nSeg < MAXSEG; q++) {
        const a = ivA[base + q * 2], b = ivA[base + q * 2 + 1];
        const maxW = (b - a) * charW;
        let range = p.layoutNextLineRange(prep, maxW, cur);
        if (!range) { cur = { segmentIndex: 0, graphemeIndex: 0 }; range = p.layoutNextLineRange(prep, maxW, cur); }
        if (!range) continue;
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
        segCol[nSeg] = a; segRow[nSeg] = r; segLen[nSeg] = len; segStr[nSeg] = str;
        nSeg++;
        textMask.fill(1, r * cols + a, r * cols + a + len);
      }
    }
  }

  /* ─── frame ───────────────────────────────────────────────────── */
  function render(t: number, dt: number) {
    lastT = t;
    frameNo++;
    kind.fill(0); zbuf.fill(0);
    const ay = t * 0.12 + rotY;
    rasterKnot(t);
    rasterLattice(t);
    rasterParticles(dt, Math.cos(ay * 0.6), Math.sin(ay * 0.6));
    updateWall();

    // intro: a print head sweeps down; rows below it are blank, rows at it are noise
    const sweep = o.intro && !still ? Math.min(1, t / INTRO_S) * (rows + 4) : 1e9;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rMax = Math.min(rows, Math.ceil(sweep));
    for (let r = 0; r < rMax; r++) {
      const head = sweep - r < 3;
      const base = r * cols, dy = r * chD;
      for (let c = 0; c < cols; c++) {
        const i = base + c;
        const k = kind[i];
        if (!k) continue;
        let g: number, s: number;
        if (k === 2) {
          const v = lbuf[i];
          if (lens[i]) { const b = v * v * v; g = G_BLOCK[1 + ((b * 3.999) | 0)]; }
          else g = G_RAMP[1 + ((v * 9) | 0)];
          s = 2 + ((v * (SHADES - 2)) | 0);
        } else {
          if (textMask[i]) continue;
          g = gbuf[i]; s = sbuf[i];
        }
        if (head) { g = NOISE[(i * 7 + frameNo * 13) % NOISE.length]; s = SHADES - 2; }
        ctx.drawImage(atlas, g * cwD, s * chD, cwD, chD, c * cwD, dy, cwD, chD);
      }
    }

    if (nSeg) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = fontStr();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = textFill;
      const rLim = sweep - 3;
      for (let q = 0; q < nSeg; q++) {
        const r = segRow[q];
        if (r >= rLim) continue;
        ctx.fillText(segStr[q], segCol[q] * cellW, (r + 0.5) * cellH + 0.5);
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
  }).catch(() => { /* no pretext: the knot still renders */ });

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
