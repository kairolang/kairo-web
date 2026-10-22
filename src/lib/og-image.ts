/**
 * KAIRO // OG cards: 1200x630 PNG social images, rendered at build time.
 *
 * Everything is drawn as vector shapes in one SVG, then rasterized by sharp:
 *  - the "KAIRO" ANSI-Shadow block logo, one cell per renderFiglet character
 *    (█ faces in red, ╔═╗║╚╝ shadow strokes in red-lo), so no font needs the
 *    box-drawing glyphs;
 *  - all text as glyph outlines read from the bundled Geist Mono TTF
 *    (node_modules/geist) via og-font.ts, so macOS and Linux CI render the
 *    exact same card (Pango/fontconfig resolve fonts differently per OS).
 *
 * Used by src/pages/og/[...slug].png.ts.
 */
import path from 'node:path';
import sharp from 'sharp';
import { renderFiglet } from './ascii/figlet';
import { loadTtf, type TtfFont } from './og-font';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const C = {
  bg: '#08080a',
  text: '#f5f5f7',
  text2: '#a1a1aa',
  text3: '#63636b',
  red: '#e8102a',
  redLo: '#8a0615',
  accent: '#ff4d61',
  rule: '#222228',
};

const FONT_DIR = path.join(process.cwd(), 'node_modules/geist/dist/fonts/geist-mono');
let fonts: { regular: TtfFont; semibold: TtfFont } | null = null;
function getFonts() {
  fonts ??= {
    regular: loadTtf(path.join(FONT_DIR, 'GeistMono-Regular.ttf')),
    semibold: loadTtf(path.join(FONT_DIR, 'GeistMono-SemiBold.ttf')),
  };
  return fonts;
}

export interface OgCard {
  /** Main line, e.g. the page title. */
  title: string;
  /** Prompt path shown as kairo@lang:~/<kicker>$, e.g. "docs/language". */
  kicker?: string;
  /** Footer tagline after "kairolang.org //". */
  subtitle?: string;
}

// ── vector ANSI-Shadow logo ─────────────────────────────────────────────
function cellShapes(ch: string, x: number, y: number, w: number, h: number): { face: string; shadow: string } {
  const r = (rx: number, ry: number, rw: number, rh: number) =>
    `<rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${rw.toFixed(2)}" height="${rh.toFixed(2)}"/>`;
  const t = Math.max(1.5, w * 0.17); // double-line stroke thickness
  const vx1 = x + w * 0.28, vx2 = x + w * 0.66; // vertical strokes (left edges)
  const hy1 = y + h * 0.36, hy2 = y + h * 0.56; // horizontal strokes (top edges)
  const R = x + w, B = y + h;
  switch (ch) {
    case '█': return { face: r(x - 0.3, y - 0.3, w + 0.6, h + 0.6), shadow: '' };
    case '▀': return { face: r(x - 0.3, y - 0.3, w + 0.6, h / 2 + 0.3), shadow: '' };
    case '▄': return { face: r(x - 0.3, y + h / 2, w + 0.6, h / 2 + 0.3), shadow: '' };
    case '═': return { face: '', shadow: r(x, hy1, w, t) + r(x, hy2, w, t) };
    case '║': return { face: '', shadow: r(vx1, y, t, h) + r(vx2, y, t, h) };
    case '╗': return { face: '', shadow: r(x, hy1, vx2 + t - x, t) + r(vx2, hy1, t, B - hy1) + r(x, hy2, vx1 + t - x, t) + r(vx1, hy2, t, B - hy2) };
    case '╔': return { face: '', shadow: r(vx1, hy1, R - vx1, t) + r(vx1, hy1, t, B - hy1) + r(vx2, hy2, R - vx2, t) + r(vx2, hy2, t, B - hy2) };
    case '╝': return { face: '', shadow: r(x, hy2, vx2 + t - x, t) + r(vx2, y, t, hy2 + t - y) + r(x, hy1, vx1 + t - x, t) + r(vx1, y, t, hy1 + t - y) };
    case '╚': return { face: '', shadow: r(vx1, hy2, R - vx1, t) + r(vx1, y, t, hy2 + t - y) + r(vx2, hy1, R - vx2, t) + r(vx2, y, t, hy1 + t - y) };
    default: return { face: '', shadow: '' };
  }
}

function logoSvg(text: string, ox: number, oy: number, cellW: number) {
  const cellH = (cellW / 0.6) * 1.3; // terminal cell: 0.6em x 1.3em
  const rows = renderFiglet(text).split('\n');
  let face = '', shadow = '';
  rows.forEach((row, ri) =>
    [...row].forEach((ch, ci) => {
      const s = cellShapes(ch, ox + ci * cellW, oy + ri * cellH, cellW, cellH);
      face += s.face;
      shadow += s.shadow;
    })
  );
  return {
    svg: `<g fill="${C.redLo}">${shadow}</g><g fill="${C.red}">${face}</g>`,
    height: rows.length * cellH,
  };
}

// ── text layout ─────────────────────────────────────────────────────────
/** Greedy wrap for a monospace font; long tokens break after "::", "<", "," or anywhere. */
function wrap(text: string, maxCols: number): string[] {
  const tokens = text.split(/(?<=\s)|(?<=::)|(?<=[<,(])/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let tok of tokens) {
    while ([...tok].length > maxCols) {
      if (cur) { lines.push(cur.trimEnd()); cur = ''; }
      lines.push([...tok].slice(0, maxCols).join(''));
      tok = [...tok].slice(maxCols).join('');
    }
    if ([...(cur + tok).trimEnd()].length > maxCols) {
      lines.push(cur.trimEnd());
      cur = tok.trimStart();
    } else cur += tok;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

function clampLines(lines: string[], maxLines: number, maxCols: number): string[] {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = [...kept[maxLines - 1]];
  kept[maxLines - 1] = last.slice(0, Math.max(1, maxCols - 3)).join('').trimEnd() + '...';
  return kept;
}

const TITLE_SIZES = [76, 66, 58, 50, 44, 38];

export async function renderOgPng(card: OgCard): Promise<Buffer> {
  const { regular, semibold } = getFonts();
  const W = OG_WIDTH, H = OG_HEIGHT, PAD = 72;
  const textW = W - PAD * 2;

  let px = PAD;
  const seg = (s: string, fill: string, font: TtfFont, size: number, y: number) => {
    const d = font.textPath(s, px, y, size);
    px += font.measure(s, size);
    return d ? `<path fill="${fill}" d="${d}"/>` : '';
  };

  // prompt: kairo@lang:~/docs/language$ █
  const kicker = (card.kicker ?? '').replace(/^\/+|\/+$/g, '');
  const pSize = 24, pY = 60 + pSize;
  let prompt = seg('kairo@lang:', C.text3, regular, pSize, pY);
  prompt += seg(`~${kicker ? '/' + kicker : ''}`, C.accent, regular, pSize, pY);
  prompt += seg('$ ', C.text3, regular, pSize, pY);
  prompt += `<rect x="${px.toFixed(1)}" y="${pY - pSize * 0.78}" width="${(pSize * 0.6).toFixed(1)}" height="${pSize * 0.98}" fill="${C.red}"/>`;

  // logo
  const LOGO_TOP = 116;
  const logo = logoSvg('KAIRO', PAD, LOGO_TOP, 11);

  // title: the largest size whose wrap fits the space without truncation
  const titleTop = LOGO_TOP + logo.height + 34;
  const titleBottom = H - 118;
  let size = TITLE_SIZES[TITLE_SIZES.length - 1];
  let lines: string[] = [];
  for (const s of TITLE_SIZES) {
    const cols = Math.floor(textW / semibold.measure('M', s));
    const maxLines = Math.max(1, Math.min(3, Math.floor((titleBottom - titleTop) / (s * 1.15))));
    const l = wrap(card.title, cols);
    size = s;
    lines = clampLines(l, maxLines, cols);
    if (l.length <= maxLines) break;
  }
  const lh = size * 1.15;
  let title = '';
  lines.forEach((line, i) => {
    const d = semibold.textPath(line, PAD, titleTop + size * 0.92 + i * lh, size);
    if (d) title += `<path fill="${C.text}" d="${d}"/>`;
  });

  // footer: kairolang.org // tagline
  const fSize = 24, fY = H - 56;
  px = PAD;
  let footer = seg('kairolang.org', C.text, regular, fSize, fY);
  footer += seg('  //  ', C.text3, regular, fSize, fY);
  const tagline = card.subtitle ?? 'The Language Beyond C++';
  const maxTag = Math.floor((W - PAD - px) / regular.measure('M', fSize));
  footer += seg([...tagline].length > maxTag ? [...tagline].slice(0, maxTag - 3).join('') + '...' : tagline, C.text2, regular, fSize, fY);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#ffffff" opacity="0.022"/></pattern>
    <pattern id="dith" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="${C.bg}"/><rect x="2" y="2" width="2" height="2" fill="${C.bg}"/></pattern>
    <linearGradient id="ramp" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${C.redLo}"/><stop offset="0.22" stop-color="${C.red}"/>
      <stop offset="0.55" stop-color="${C.red}" stop-opacity="0.35"/><stop offset="1" stop-color="${C.red}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.2" cy="0.3" r="0.65">
      <stop offset="0" stop-color="${C.red}" stop-opacity="0.11"/><stop offset="1" stop-color="${C.red}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect width="${W}" height="${H}" fill="url(#scan)"/>
  <rect width="${W}" height="10" fill="url(#ramp)"/>
  <rect width="${W}" height="10" fill="url(#dith)"/>
  <rect x="${PAD}" y="${H - 98}" width="${textW}" height="1" fill="${C.rule}"/>
  ${prompt}
  ${logo.svg}
  ${title}
  ${footer}
</svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
