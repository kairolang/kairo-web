/**
 * KAIRO // ASCII - the text wall under dot_product.k.
 *
 * When the code window is resized narrower than its default box, the space it
 * vacates fills with the same reflowing source text as the hero wall, laid
 * out by @chenglou/pretext around the window's live edges. Nothing renders at
 * the default size, so the resting page is unchanged.
 *
 * draw(w, h) is meant to be called from a ResizeObserver on the frame (after
 * layout, before paint): geometry is arithmetic on the cached wrap metrics,
 * so a drag never forces a synchronous layout. No rAF loop: it only paints
 * when the window changes size.
 */
import { cssVar, onThemeChange } from '../../../lib/ascii/motion';

type Pretext = typeof import('@chenglou/pretext');
type Prepared = ReturnType<Pretext['prepareWithSegments']>;
type Cursor = { segmentIndex: number; graphemeIndex: number };

export interface GutterWallOptions {
  /** positioned wrapper around the frame (the canvas spans its padding box) */
  wrap: HTMLElement;
  /** the resizable, horizontally-centred frame */
  frame: HTMLElement;
  /** default (resting) max width of the frame in px */
  defaultMax: number;
  text: string;
}

export interface GutterWall {
  /** re-read wrap metrics (on wrap resize) */
  measure(): void;
  /** paint for a frame of border-box size w × h */
  draw(w: number, h: number): void;
  destroy(): void;
}

const ZERO: Cursor = { segmentIndex: 0, graphemeIndex: 0 };

export function createGutterWall(o: GutterWallOptions): GutterWall {
  const { wrap, frame } = o;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-gutter-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;pointer-events:none;z-index:0;display:block;';
  wrap.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true })!;

  let pt: Pretext | null = null;
  let prepared: Prepared | null = null;
  let preparedFont = '';
  const cache = new Map<number, string>();

  let dpr = 1, size = 12, charW = 7.2, lineH = 15;
  let wrapW = 0, cx = 0, defW = 0, top = 0, canvasH = 0;
  let rgb = '161,161,170', baseA = 0.4;
  let painted = false;
  let lastW = 0, lastH = 0;

  const font = () => `400 ${size}px "Geist Mono"`;

  function colors() {
    ctx.fillStyle = '#000';
    ctx.fillStyle = cssVar('--text-2') || '#a1a1aa';
    const s = String(ctx.fillStyle);
    if (s.startsWith('#')) {
      const n = parseInt(s.slice(1, 7), 16);
      rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    }
    baseA = document.documentElement.getAttribute('data-theme') === 'light' ? 0.42 : 0.36;
  }

  function ensurePrepared() {
    if (!pt) return;
    const f = font();
    if (f === preparedFont && prepared) return;
    try { prepared = pt.prepareWithSegments(o.text, f); preparedFont = f; cache.clear(); }
    catch { prepared = null; }
  }

  function measure() {
    const cs = getComputedStyle(wrap);
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
    wrapW = wrap.clientWidth;
    const contentW = Math.max(0, wrapW - pl - pr);
    cx = pl + contentW / 2;
    defW = Math.min(o.defaultMax, contentW);
    top = frame.offsetTop;
    canvas.style.top = top + 'px';
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    size = window.innerWidth >= 960 ? 12 : 11;
    charW = size * 0.6;
    lineH = size * 1.25;
    canvas.width = Math.max(1, Math.round(wrapW * dpr));
    colors();
    ensurePrepared();
    // setting canvas.width wiped the backing store; repaint from the new
    // centre/default width (the pinned frame gets no RO entry of its own)
    if (lastW) draw(lastW, lastH);
  }

  function sizeCanvas(h: number) {
    // grow-only backing store, so a drag doesn't reallocate every frame
    if (h <= canvasH) return;
    canvasH = Math.ceil(h / 64) * 64;
    canvas.height = Math.max(1, Math.round(canvasH * dpr));
    canvas.style.height = canvasH + 'px';
  }

  function clear() {
    if (!painted) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    painted = false;
  }

  function line(maxW: number, cur: Cursor): { str: string; end: Cursor } | null {
    const p = pt!, prep = prepared!;
    let range = p.layoutNextLineRange(prep, maxW, cur);
    if (!range) range = p.layoutNextLineRange(prep, maxW, ZERO);
    if (!range) return null;
    const s0 = range.start, e0 = range.end;
    const key = ((s0.segmentIndex * 64 + Math.min(63, s0.graphemeIndex)) * 32768 + e0.segmentIndex) * 64 + Math.min(63, e0.graphemeIndex);
    let str = cache.get(key);
    if (str === undefined) {
      str = p.materializeLineRange(prep, range).text.replace(/\s+$/, '');
      if (cache.size > 4000) cache.clear();
      cache.set(key, str);
    }
    return { str, end: e0 };
  }

  function draw(w: number, h: number) {
    lastW = w; lastH = h;
    const vac = (defW - w) / 2; // px vacated on each side
    const gap = charW * 2;
    const spanW = Math.floor((vac - gap) / charW) * charW;
    if (!pt || !prepared || spanW < charW * 4 || h <= 0) { clear(); return; }
    sizeCanvas(h);
    // fade in over the first few vacated columns: no pop, no flash
    const a = Math.min(1, (spanW - charW * 4) / (charW * 8));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = font();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${rgb},${(baseA * (0.35 + 0.65 * a)).toFixed(3)})`;
    const lx = cx - w / 2 - gap; // left span ends here (text hugs the window)
    const rx = cx + w / 2 + gap; // right span starts here
    const rows = Math.floor((h - lineH * 0.5) / lineH);
    let cur: Cursor = ZERO;
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * lineH + 0.5 + lineH * 0.25;
      const L = line(spanW, cur);
      if (!L) break;
      cur = L.end;
      ctx.textAlign = 'right';
      ctx.fillText(L.str, lx, y);
      const R = line(spanW, cur);
      if (!R) break;
      cur = R.end;
      ctx.textAlign = 'left';
      ctx.fillText(R.str, rx, y);
    }
    painted = true;
  }

  measure();
  const offTheme = onThemeChange(() => { colors(); if (painted) draw(lastW, lastH); });
  let dead = false;
  import('@chenglou/pretext').then((mod) => {
    if (dead) return;
    pt = mod;
    ensurePrepared();
    if (lastW) draw(lastW, lastH);
  }).catch(() => { /* no pretext: the window still resizes */ });

  return {
    measure,
    draw,
    destroy() { dead = true; offTheme(); canvas.remove(); },
  };
}
