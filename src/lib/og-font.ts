/**
 * Minimal TrueType (glyf) outline reader → SVG path data.
 *
 * Used by the OG card renderer so text is drawn as vector paths from the
 * bundled Geist Mono TTF instead of going through Pango/fontconfig (which
 * resolves fonts differently on macOS vs Linux CI). Supports cmap formats
 * 4 and 12, simple + composite glyphs (offset/scale), and hmtx advances.
 * No shaping/kerning: Geist Mono is monospaced, so that is all we need.
 */
import fs from 'node:fs';

export interface TtfFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  advance(cp: number): number;
  /** SVG path for one code point at (x, baselineY) and `size` px. */
  glyphPath(cp: number, x: number, y: number, size: number): string;
  /** Width of a string in px at `size`. */
  measure(text: string, size: number): number;
  /** SVG path for a whole string starting at (x, baselineY). */
  textPath(text: string, x: number, y: number, size: number): string;
}

type Pt = { x: number; y: number; on: boolean };

export function loadTtf(file: string): TtfFont {
  const buf = fs.readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o: number) => dv.getUint16(o);
  const i16 = (o: number) => dv.getInt16(o);
  const u32 = (o: number) => dv.getUint32(o);

  const tables: Record<string, number> = {};
  const numTables = u16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(buf[rec], buf[rec + 1], buf[rec + 2], buf[rec + 3]);
    tables[tag] = u32(rec + 8);
  }
  const need = ['head', 'hhea', 'hmtx', 'loca', 'glyf', 'cmap', 'maxp'];
  for (const t of need) if (tables[t] == null) throw new Error(`ttf: missing ${t} table in ${file}`);

  const unitsPerEm = u16(tables.head + 18);
  const locFormat = i16(tables.head + 50);
  const ascender = i16(tables.hhea + 4);
  const descender = i16(tables.hhea + 6);
  const numHMetrics = u16(tables.hhea + 34);
  const numGlyphs = u16(tables.maxp + 4);

  const loca = (g: number) =>
    locFormat === 0 ? u16(tables.loca + g * 2) * 2 : u32(tables.loca + g * 4);
  const advanceOf = (g: number) => u16(tables.hmtx + Math.min(g, numHMetrics - 1) * 4);

  // ── cmap: prefer (3,10) format 12, else (3,1)/(0,x) format 4
  let cmap4 = -1;
  let cmap12 = -1;
  const nSub = u16(tables.cmap + 2);
  for (let i = 0; i < nSub; i++) {
    const pid = u16(tables.cmap + 4 + i * 8);
    const eid = u16(tables.cmap + 6 + i * 8);
    const off = tables.cmap + u32(tables.cmap + 8 + i * 8);
    const fmt = u16(off);
    if (fmt === 12 && (pid === 0 || (pid === 3 && eid === 10))) cmap12 = off;
    if (fmt === 4 && (pid === 0 || (pid === 3 && eid === 1))) cmap4 = off;
  }
  const cache = new Map<number, number>();
  function glyphIndex(cp: number): number {
    const hit = cache.get(cp);
    if (hit != null) return hit;
    let g = 0;
    if (cmap12 >= 0) {
      const n = u32(cmap12 + 12);
      for (let i = 0; i < n; i++) {
        const r = cmap12 + 16 + i * 12;
        const start = u32(r), end = u32(r + 4);
        if (cp >= start && cp <= end) { g = u32(r + 8) + (cp - start); break; }
      }
    } else if (cmap4 >= 0 && cp <= 0xffff) {
      const segX2 = u16(cmap4 + 6);
      const ends = cmap4 + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        if (cp > u16(ends + s)) continue;
        const start = u16(starts + s);
        if (cp < start) break;
        const delta = i16(deltas + s);
        const ro = u16(ranges + s);
        if (ro === 0) g = (cp + delta) & 0xffff;
        else {
          const gi = u16(ranges + s + ro + (cp - start) * 2);
          g = gi === 0 ? 0 : (gi + delta) & 0xffff;
        }
        break;
      }
    }
    if (g >= numGlyphs) g = 0;
    cache.set(cp, g);
    return g;
  }

  // ── glyf: contours in font units (y up)
  function contours(g: number, depth = 0): Pt[][] {
    if (depth > 8) return [];
    const start = loca(g), end = loca(g + 1);
    if (end <= start) return []; // empty glyph (space)
    const o = tables.glyf + start;
    const nC = i16(o);
    if (nC >= 0) {
      const endPts: number[] = [];
      for (let i = 0; i < nC; i++) endPts.push(u16(o + 10 + i * 2));
      const nPts = nC ? endPts[nC - 1] + 1 : 0;
      let p = o + 10 + nC * 2;
      p += 2 + u16(p); // skip instructions
      const flags: number[] = [];
      while (flags.length < nPts) {
        const f = buf[p++];
        flags.push(f);
        if (f & 8) { let rep = buf[p++]; while (rep--) flags.push(f); }
      }
      const xs: number[] = [], ys: number[] = [];
      let v = 0;
      for (const f of flags) {
        if (f & 2) { const d = buf[p++]; v += f & 16 ? d : -d; }
        else if (!(f & 16)) { v += i16(p); p += 2; }
        xs.push(v);
      }
      v = 0;
      for (const f of flags) {
        if (f & 4) { const d = buf[p++]; v += f & 32 ? d : -d; }
        else if (!(f & 32)) { v += i16(p); p += 2; }
        ys.push(v);
      }
      const out: Pt[][] = [];
      let s = 0;
      for (const e of endPts) {
        const c: Pt[] = [];
        for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
        out.push(c);
        s = e + 1;
      }
      return out;
    }
    // composite
    const out: Pt[][] = [];
    let p = o + 10;
    for (;;) {
      const flags = u16(p);
      const gi = u16(p + 2);
      p += 4;
      let dx = 0, dy = 0;
      if (flags & 1) { dx = i16(p); dy = i16(p + 2); p += 4; }
      else { dx = dv.getInt8(p); dy = dv.getInt8(p + 1); p += 2; }
      let a = 1, b = 0, c = 0, d = 1;
      const f2 = (q: number) => i16(q) / 16384;
      if (flags & 8) { a = d = f2(p); p += 2; }
      else if (flags & 0x40) { a = f2(p); d = f2(p + 2); p += 4; }
      else if (flags & 0x80) { a = f2(p); b = f2(p + 2); c = f2(p + 4); d = f2(p + 6); p += 8; }
      for (const ct of contours(gi, depth + 1)) {
        out.push(ct.map(pt => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
      }
      if (!(flags & 0x20)) break;
    }
    return out;
  }

  const r = (n: number) => Math.round(n * 100) / 100;

  function glyphPath(cp: number, x: number, y: number, size: number): string {
    const s = size / unitsPerEm;
    const X = (u: number) => r(x + u * s);
    const Y = (u: number) => r(y - u * s);
    let d = '';
    for (const c of contours(glyphIndex(cp))) {
      if (!c.length) continue;
      // start at an on-curve point (or the midpoint of two off-curve points)
      let startIdx = c.findIndex(pt => pt.on);
      let first: Pt;
      if (startIdx < 0) {
        first = { x: (c[0].x + c[1 % c.length].x) / 2, y: (c[0].y + c[1 % c.length].y) / 2, on: true };
        startIdx = 0;
      } else first = c[startIdx];
      d += `M${X(first.x)} ${Y(first.y)}`;
      const n = c.length;
      let ctrl: Pt | null = null;
      for (let k = 1; k <= n; k++) {
        const pt = c[(startIdx + k) % n];
        const isClose = k === n;
        const target = isClose ? first : pt;
        if (!isClose && !pt.on) {
          if (ctrl) {
            const mid = { x: (ctrl.x + pt.x) / 2, y: (ctrl.y + pt.y) / 2 };
            d += `Q${X(ctrl.x)} ${Y(ctrl.y)} ${X(mid.x)} ${Y(mid.y)}`;
          }
          ctrl = pt;
          continue;
        }
        if (ctrl) d += `Q${X(ctrl.x)} ${Y(ctrl.y)} ${X(target.x)} ${Y(target.y)}`;
        else d += `L${X(target.x)} ${Y(target.y)}`;
        ctrl = null;
      }
      d += 'Z';
    }
    return d;
  }

  const advance = (cp: number) => advanceOf(glyphIndex(cp));
  return {
    unitsPerEm,
    ascender,
    descender,
    advance,
    glyphPath,
    measure(text, size) {
      let w = 0;
      for (const ch of text) w += advance(ch.codePointAt(0)!);
      return (w * size) / unitsPerEm;
    },
    textPath(text, x, y, size) {
      let d = '';
      let pen = x;
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        d += glyphPath(cp, pen, y, size);
        pen += (advance(cp) * size) / unitsPerEm;
      }
      return d;
    },
  };
}
