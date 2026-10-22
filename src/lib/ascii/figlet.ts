/**
 * KAIRO // ASCII — hand-built "ANSI Shadow" style block font.
 *
 * Pure string work: safe at build time (Astro frontmatter) and in the browser.
 *
 *   import { renderFiglet } from '@/lib/ascii/figlet';
 *   renderFiglet('KAIRO');           // 6-row block string, rows joined by '\n'
 *   figletSize('KAIRO');             // { cols: 41, rows: 6 }
 *
 * Every glyph is 6 rows tall. Glyphs use only characters Geist Mono ships
 * (█ ╗ ╔ ═ ║ ╝ ╚ ▄ ▀), all with a 0.6em advance, so a rendered block is
 * exactly `cols * 0.6em` wide. Render with line-height 1.3 (see .ascii-art)
 * so █ and ║ tile seamlessly between rows.
 */

export const FIGLET_ROWS = 6;

// Raw glyphs. Rows may be ragged in source; they are right-padded on load.
const RAW: Record<string, string[]> = {
  A: [
    ' █████╗ ',
    '██╔══██╗',
    '███████║',
    '██╔══██║',
    '██║  ██║',
    '╚═╝  ╚═╝',
  ],
  B: [
    '██████╗ ',
    '██╔══██╗',
    '██████╔╝',
    '██╔══██╗',
    '██████╔╝',
    '╚═════╝ ',
  ],
  C: [
    ' ██████╗',
    '██╔════╝',
    '██║     ',
    '██║     ',
    '╚██████╗',
    ' ╚═════╝',
  ],
  D: [
    '██████╗ ',
    '██╔══██╗',
    '██║  ██║',
    '██║  ██║',
    '██████╔╝',
    '╚═════╝ ',
  ],
  E: [
    '███████╗',
    '██╔════╝',
    '█████╗  ',
    '██╔══╝  ',
    '███████╗',
    '╚══════╝',
  ],
  F: [
    '███████╗',
    '██╔════╝',
    '█████╗  ',
    '██╔══╝  ',
    '██║     ',
    '╚═╝     ',
  ],
  G: [
    ' ██████╗ ',
    '██╔════╝ ',
    '██║  ███╗',
    '██║   ██║',
    '╚██████╔╝',
    ' ╚═════╝ ',
  ],
  H: [
    '██╗  ██╗',
    '██║  ██║',
    '███████║',
    '██╔══██║',
    '██║  ██║',
    '╚═╝  ╚═╝',
  ],
  I: [
    '██╗',
    '██║',
    '██║',
    '██║',
    '██║',
    '╚═╝',
  ],
  J: [
    '     ██╗',
    '     ██║',
    '     ██║',
    '██   ██║',
    '╚█████╔╝',
    ' ╚════╝ ',
  ],
  K: [
    '██╗  ██╗',
    '██║ ██╔╝',
    '█████╔╝ ',
    '██╔═██╗ ',
    '██║  ██╗',
    '╚═╝  ╚═╝',
  ],
  L: [
    '██╗     ',
    '██║     ',
    '██║     ',
    '██║     ',
    '███████╗',
    '╚══════╝',
  ],
  M: [
    '███╗   ███╗',
    '████╗ ████║',
    '██╔████╔██║',
    '██║╚██╔╝██║',
    '██║ ╚═╝ ██║',
    '╚═╝     ╚═╝',
  ],
  N: [
    '███╗   ██╗',
    '████╗  ██║',
    '██╔██╗ ██║',
    '██║╚██╗██║',
    '██║ ╚████║',
    '╚═╝  ╚═══╝',
  ],
  O: [
    ' ██████╗ ',
    '██╔═══██╗',
    '██║   ██║',
    '██║   ██║',
    '╚██████╔╝',
    ' ╚═════╝ ',
  ],
  P: [
    '██████╗ ',
    '██╔══██╗',
    '██████╔╝',
    '██╔═══╝ ',
    '██║     ',
    '╚═╝     ',
  ],
  Q: [
    ' ██████╗ ',
    '██╔═══██╗',
    '██║   ██║',
    '██║▄▄ ██║',
    '╚██████╔╝',
    ' ╚══▀▀═╝ ',
  ],
  R: [
    '██████╗ ',
    '██╔══██╗',
    '██████╔╝',
    '██╔══██╗',
    '██║  ██║',
    '╚═╝  ╚═╝',
  ],
  S: [
    '███████╗',
    '██╔════╝',
    '███████╗',
    '╚════██║',
    '███████║',
    '╚══════╝',
  ],
  T: [
    '████████╗',
    '╚══██╔══╝',
    '   ██║   ',
    '   ██║   ',
    '   ██║   ',
    '   ╚═╝   ',
  ],
  U: [
    '██╗   ██╗',
    '██║   ██║',
    '██║   ██║',
    '██║   ██║',
    '╚██████╔╝',
    ' ╚═════╝ ',
  ],
  V: [
    '██╗   ██╗',
    '██║   ██║',
    '██║   ██║',
    '╚██╗ ██╔╝',
    ' ╚████╔╝ ',
    '  ╚═══╝  ',
  ],
  W: [
    '██╗    ██╗',
    '██║    ██║',
    '██║ █╗ ██║',
    '██║███╗██║',
    '╚███╔███╔╝',
    ' ╚══╝╚══╝ ',
  ],
  X: [
    '██╗  ██╗',
    '╚██╗██╔╝',
    ' ╚███╔╝ ',
    ' ██╔██╗ ',
    '██╔╝ ██╗',
    '╚═╝  ╚═╝',
  ],
  Y: [
    '██╗   ██╗',
    '╚██╗ ██╔╝',
    ' ╚████╔╝ ',
    '  ╚██╔╝  ',
    '   ██║   ',
    '   ╚═╝   ',
  ],
  Z: [
    '███████╗',
    '╚══███╔╝',
    '  ███╔╝ ',
    ' ███╔╝  ',
    '███████╗',
    '╚══════╝',
  ],
  '0': [
    ' ██████╗ ',
    '██╔═████╗',
    '██║██╔██║',
    '████╔╝██║',
    '╚██████╔╝',
    ' ╚═════╝ ',
  ],
  '1': [
    ' ██╗',
    '███║',
    '╚██║',
    ' ██║',
    ' ██║',
    ' ╚═╝',
  ],
  '2': [
    '██████╗ ',
    '╚════██╗',
    ' █████╔╝',
    '██╔═══╝ ',
    '███████╗',
    '╚══════╝',
  ],
  '3': [
    '██████╗ ',
    '╚════██╗',
    ' █████╔╝',
    ' ╚═══██╗',
    '██████╔╝',
    '╚═════╝ ',
  ],
  '4': [
    '██╗  ██╗',
    '██║  ██║',
    '███████║',
    '╚════██║',
    '     ██║',
    '     ╚═╝',
  ],
  '5': [
    '███████╗',
    '██╔════╝',
    '███████╗',
    '╚════██║',
    '███████║',
    '╚══════╝',
  ],
  '6': [
    ' ██████╗ ',
    '██╔════╝ ',
    '███████╗ ',
    '██╔═══██╗',
    '╚██████╔╝',
    ' ╚═════╝ ',
  ],
  '7': [
    '███████╗',
    '╚════██║',
    '    ██╔╝',
    '   ██╔╝ ',
    '   ██║  ',
    '   ╚═╝  ',
  ],
  '8': [
    ' █████╗ ',
    '██╔══██╗',
    '╚█████╔╝',
    '██╔══██╗',
    '╚█████╔╝',
    ' ╚════╝ ',
  ],
  '9': [
    ' █████╗ ',
    '██╔══██╗',
    '╚██████║',
    ' ╚═══██║',
    ' █████╔╝',
    ' ╚════╝ ',
  ],
  ' ': [
    '   ',
    '   ',
    '   ',
    '   ',
    '   ',
    '   ',
  ],
  '-': [
    '      ',
    '      ',
    '█████╗',
    '╚════╝',
    '      ',
    '      ',
  ],
  '+': [
    '       ',
    '  ██╗  ',
    '██████╗',
    '╚═██╔═╝',
    '  ╚═╝  ',
    '       ',
  ],
  '.': [
    '   ',
    '   ',
    '   ',
    '   ',
    '██╗',
    '╚═╝',
  ],
  ':': [
    '   ',
    '██╗',
    '╚═╝',
    '██╗',
    '╚═╝',
    '   ',
  ],
  '!': [
    '██╗',
    '██║',
    '██║',
    '╚═╝',
    '██╗',
    '╚═╝',
  ],
  '?': [
    '██████╗ ',
    '╚════██╗',
    '  ▄███╔╝',
    '  ▀▀══╝ ',
    '  ██╗   ',
    '  ╚═╝   ',
  ],
  '/': [
    '    ██╗',
    '   ██╔╝',
    '  ██╔╝ ',
    ' ██╔╝  ',
    '██╔╝   ',
    '╚═╝    ',
  ],
  '#': [
    ' ██╗ ██╗ ',
    '████████╗',
    '╚██╔═██╔╝',
    '████████╗',
    '╚██╔═██╔╝',
    ' ╚═╝ ╚═╝ ',
  ],
  '[': [
    '███╗',
    '██╔╝',
    '██║ ',
    '██║ ',
    '███╗',
    '╚══╝',
  ],
  ']': [
    '███╗',
    '╚██║',
    ' ██║',
    ' ██║',
    '███║',
    '╚══╝',
  ],
  _: [
    '        ',
    '        ',
    '        ',
    '        ',
    '███████╗',
    '╚══════╝',
  ],
  '>': [
    '██╗  ',
    '╚██╗ ',
    ' ╚██╗',
    ' ██╔╝',
    '██╔╝ ',
    '╚═╝  ',
  ],
  '<': [
    '  ██╗',
    ' ██╔╝',
    '██╔╝ ',
    '╚██╗ ',
    ' ╚██╗',
    '  ╚═╝',
  ],
};

/** Normalised glyph table: every glyph has FIGLET_ROWS rows of equal width. */
const GLYPHS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [ch, rows] of Object.entries(RAW)) {
    const w = Math.max(...rows.map((r) => [...r].length));
    out[ch] = rows.map((r) => r + ' '.repeat(w - [...r].length));
  }
  return out;
})();

/** Characters the font can draw (others are rendered as '?'). */
export const FIGLET_CHARSET = Object.keys(GLYPHS).join('');

export interface FigletOptions {
  /** Extra blank columns between glyphs. Default 0 (ANSI Shadow glyphs carry their own shadow column). */
  letterSpacing?: number;
  /** Trim trailing spaces from every row. Default true. */
  trimRight?: boolean;
}

function glyphFor(ch: string): string[] {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
}

function renderLine(line: string, opts: FigletOptions): string[] {
  const gap = ' '.repeat(Math.max(0, opts.letterSpacing ?? 0));
  const rows: string[] = Array.from({ length: FIGLET_ROWS }, () => '');
  const chars = [...line];
  chars.forEach((ch, i) => {
    const g = glyphFor(ch);
    for (let r = 0; r < FIGLET_ROWS; r++) rows[r] += g[r] + (i < chars.length - 1 ? gap : '');
  });
  return rows;
}

/**
 * Render text as block letters. '\n' in `text` starts a new block line
 * (separated by one empty row). Lower-case input is upper-cased.
 */
export function renderFiglet(text: string, opts: FigletOptions = {}): string {
  const trim = opts.trimRight ?? true;
  const blocks = text.split('\n').map((l) => renderLine(l, opts));
  // Pad all rows to a common width so the block is a clean rectangle
  // (trimRight only strips what is blank in EVERY row).
  let rows = blocks.flatMap((b, i) => (i < blocks.length - 1 ? [...b, ''] : b));
  const width = Math.max(...rows.map((r) => [...r].length));
  rows = rows.map((r) => r + ' '.repeat(width - [...r].length));
  if (trim) {
    let cut = width;
    while (cut > 0 && rows.every((r) => [...r][cut - 1] === ' ')) cut--;
    rows = rows.map((r) => [...r].slice(0, cut).join(''));
  }
  return rows.join('\n');
}

/** Columns × rows of a rendered string (use for --cols on .ascii-art). */
export function artSize(art: string): { cols: number; rows: number } {
  const lines = art.split('\n');
  return { cols: Math.max(...lines.map((l) => [...l].length)), rows: lines.length };
}

/** Convenience: size of renderFiglet(text, opts). */
export function figletSize(text: string, opts: FigletOptions = {}): { cols: number; rows: number } {
  return artSize(renderFiglet(text, opts));
}

/**
 * Two-tone HTML for ANSI-Shadow art: █▄▀ faces in <span class="f">, the
 * ╗╔═║╝╚ shadow strokes in <span class="s">. Everything else is escaped.
 * Use with set:html on an .ascii-art element (colours: --art-face / --art-shadow).
 */
export function toneArt(art: string): string {
  const esc = art.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/[█▄▀]+/g, (m) => `<span class="f">${m}</span>`)
    .replace(/[╗╔═║╝╚]+/g, (m) => `<span class="s">${m}</span>`);
}
