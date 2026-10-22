/**
 * KAIRO // ASCII - the hero figure: a Penrose tribar (the logo's construction).
 *
 * An impossible triangle can't be one rigid solid, so it is built the
 * classic way: three square-section bars run along +x, +y, +z from corner
 * cube C0 -> C1 -> C2 -> C3. Seen orthographically along (1,1,1), C3 projects
 * exactly onto C0, so the three bars close into the impossible loop (the
 * near end of the z bar sits over the far start of the x bar). Any turn that
 * isn't about the view axis pulls C3 off C0 and gives the trick away, so
 * the figure only ever rolls about that axis (plus a hair of pointer tilt).
 *
 * Rendering is exact per cell, not point-sampled: every cell casts 2x2
 * orthographic rays against the three boxes in object space. Each face is
 * flat-lit, so the three visible face families read as three distinct
 * tones, plus the logo's crossed gradients: every face family is brightest
 * at the corner its L-shaped strip wraps around and darkens along both bars
 * away from it, so each bar shows one face brightening toward one end and
 * the other toward the opposite end. The base follows the logo's base
 * instead: two equal bands snapped to whole rows, crossing full-to-faint.
 *
 * Motion (driven by scene.ts's loop time): it always holds the illusion
 * view, with a slow roll sway about the view axis (which never breaks the
 * illusion); there is no reveal turn. Pointer: a small in-plane lean plus
 * <= 0.6 degrees of out-of-plane tilt, too little to pull the seam apart. Still:
 * the exact illusion.
 *
 * No per-frame allocations: the pose, rays and boxes live in preallocated
 * Float64Arrays; the raster writes straight into the scene's typed buffers.
 */

export interface PenroseGrid {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** 0 free, 1 lattice/particle, 2 figure ink, 3 reserved (the hole: no ink, no text) */
  kind: Uint8Array;
  lbuf: Float32Array;
  lens: Uint8Array;
}

export interface PenroseBox { x0: number; x1: number; y0: number; y1: number }

/* ─── motion ────────────────────────────────────────────────────── */
const SWAY = 2.2 * Math.PI / 180;  // resting roll sway amplitude
const SWAY_T = 13;                 // sway period (s)
const LEAN = 2.4 * Math.PI / 180;  // pointer: max in-plane lean
// pointer: max out-of-plane tilt. Any yaw/pitch slides the seam end (C3)
// off C0 by about sqrt(3)*sin(angle) of a side; 0.6 degrees keeps that under ~1 cell
const TILT = 0.6 * Math.PI / 180;
/** mirror the image so the face/gradient layout follows the logo */
const MIRROR = true;

/* light (surface -> light) in camera space: left-front. At the illusion view
   the three face families light at about .05 / .94 / .34: dark, bright, mid */
const LX0 = -0.6, LY0 = -0.2, LZ0 = -0.75;

export function createPenrose() {
  /* geometry */
  let w = 0.12;                              // bar thickness (L = 1)
  const box = new Float64Array(18);          // 3 boxes x [x0,y0,z0,x1,y1,z1]
  const piv = new Float64Array(3);
  /* base orientation: camera axes in object coordinates (rows) */
  const B = new Float64Array(9);
  /* current pose: rows = camera x, y, z axes in object coords */
  const M = new Float64Array(9);
  const face = new Float64Array(6);          // lit value per face normal (+/-x, +/-y, +/-z)

  function setBar(nw: number) {
    w = nw;
    const L = 1;
    // bar 0: C0 -> C1 along x; bar 1: C1 -> C2 along y; bar 2: C2 -> C3 along z
    box.set([0, 0, 0, L + w, w, w], 0);
    box.set([L, 0, 0, L + w, L + w, w], 6);
    box.set([L, L, 0, L + w, L + w, L + w], 12);
    // pivot: on the view-axis line through the triangle's centroid, at mid depth
    piv[0] = 5 / 6 + w / 2; piv[1] = 0.5 + w / 2; piv[2] = 1 / 6 + w / 2;
    buildBase();
  }

  function buildBase() {
    const r3 = 1 / Math.sqrt(3);
    // camera z (away from the viewer) = -(1,1,1)/sqrt(3)
    const zx = -r3, zy = -r3, zz = -r3;
    // any x perpendicular to view, then y = z cross x (x right, y down, z in: right-handed)
    let xx = 1 / Math.SQRT2, xy = -1 / Math.SQRT2, xz = 0;
    let yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    // roll in-plane so the seam corner (C0 = C3) is the apex, pointing up
    const c = w / 2;
    const gx = (0 + 1 + 1) / 3 + c, gy = (0 + 0 + 1) / 3 + c, gz = c; // centroid of C0, C1, C2
    const vx = c - gx, vy = c - gy, vz = c - gz;                        // centroid -> C0
    const sx = vx * xx + vy * xy + vz * xz, sy = vx * yx + vy * yy + vz * yz;
    // want (sx, sy) -> (0, -|s|): rotate the basis by phi
    const phi = Math.atan2(sx, -sy);
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const nxx = cp * xx + sp * yx, nxy = cp * xy + sp * yy, nxz = cp * xz + sp * yz;
    const nyx = -sp * xx + cp * yx, nyy = -sp * xy + cp * yy, nyz = -sp * xz + cp * yz;
    xx = nxx; xy = nxy; xz = nxz; yx = nyx; yy = nyy; yz = nyz;
    B[0] = xx; B[1] = xy; B[2] = xz;
    B[3] = yx; B[4] = yy; B[5] = yz;
    B[6] = zx; B[7] = zy; B[8] = zz;
  }

  /**
   * Pose at loop time t. With still set, it is the exact impossible view.
   * px/py are the scene's eased pointer values (any scale; clamped here).
   */
  function pose(t: number, still: boolean, px: number, py: number) {
    if (still) { poseRaw(0, 0, 0); return; }
    poseRaw(
      clamp(px * 0.03, -TILT, TILT),
      clamp(-py * 0.03, -TILT, TILT),
      SWAY * Math.sin((t / SWAY_T) * Math.PI * 2) + clamp(px * 0.05, -LEAN, LEAN),
    );
  }

  /** M = Rz(roll) * Rx(pitch) * Ry(yaw) * B, applied to B's rows as camera-space mixes */
  function poseRaw(yaw: number, pitch: number, roll: number) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cx = Math.cos(pitch), sx = Math.sin(pitch);
    const cz = Math.cos(roll), sz = Math.sin(roll);
    // R = Rz*Rx*Ry (camera-space rotation), rows r0..r2
    const r00 = cz * cy + sz * sx * sy, r01 = -sz * cx, r02 = -cz * sy + sz * sx * cy;
    const r10 = sz * cy - cz * sx * sy, r11 = cz * cx, r12 = -sz * sy - cz * sx * cy;
    const r20 = cx * sy, r21 = sx, r22 = cx * cy;
    for (let k = 0; k < 3; k++) {
      const b0 = B[k], b1 = B[3 + k], b2 = B[6 + k];
      M[k] = r00 * b0 + r01 * b1 + r02 * b2;
      M[3 + k] = r10 * b0 + r11 * b1 + r12 * b2;
      M[6 + k] = r20 * b0 + r21 * b1 + r22 * b2;
    }
    // flat light per face normal: n_cam = +/- column k of M
    const lx = MIRROR ? -LX0 : LX0;
    const ll = Math.hypot(lx, LY0, LZ0);
    for (let k = 0; k < 3; k++) {
      const d = (M[k] * lx + M[3 + k] * LY0 + M[6 + k] * LZ0) / ll;
      face[k * 2] = Math.max(0, -d);
      face[k * 2 + 1] = Math.max(0, d);
    }
  }

  /** project an object point to screen units (relative to the pivot), out = [x, y] */
  function project(x: number, y: number, z: number, out: Float64Array) {
    const dx = x - piv[0], dy = y - piv[1], dz = z - piv[2];
    const X = M[0] * dx + M[1] * dy + M[2] * dz;
    const Y = M[3] * dx + M[4] * dy + M[5] * dz;
    out[0] = MIRROR ? -X : X; out[1] = Y;
  }

  const pt = new Float64Array(2);
  /** screen-unit bbox of the figure in the current pose (pivot at 0,0) */
  function bounds(out: PenroseBox) {
    out.x0 = out.y0 = Infinity; out.x1 = out.y1 = -Infinity;
    for (let b = 0; b < 3; b++) {
      const o = b * 6;
      for (let m = 0; m < 8; m++) {
        project(box[o + (m & 1 ? 3 : 0)], box[o + 1 + (m & 2 ? 3 : 0)], box[o + 2 + (m & 4 ? 3 : 0)], pt);
        if (pt[0] < out.x0) out.x0 = pt[0];
        if (pt[0] > out.x1) out.x1 = pt[0];
        if (pt[1] < out.y0) out.y0 = pt[1];
        if (pt[1] > out.y1) out.y1 = pt[1];
      }
    }
  }

  /** bbox at rest, and the union over every pose the motion can reach */
  function extents(): { rest: PenroseBox; any: PenroseBox } {
    const rest = { x0: 0, x1: 0, y0: 0, y1: 0 };
    const any = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    const tmp = { x0: 0, x1: 0, y0: 0, y1: 0 };
    pose(0, true, 0, 0); bounds(rest);
    // roll through the full sway + lean range at each tilt corner
    for (let i = 0; i <= 24; i++) {
      const roll = (i / 12 - 1) * (SWAY + LEAN);
      for (let e = 0; e < 4; e++) {
        poseRaw(e & 1 ? TILT : -TILT, e & 2 ? TILT : -TILT, roll);
        bounds(tmp);
        if (tmp.x0 < any.x0) any.x0 = tmp.x0;
        if (tmp.x1 > any.x1) any.x1 = tmp.x1;
        if (tmp.y0 < any.y0) any.y0 = tmp.y0;
        if (tmp.y1 > any.y1) any.y1 = tmp.y1;
      }
    }
    pose(0, true, 0, 0);
    return { rest, any };
  }

  /* ray state (no per-sample allocations) */
  let hitV = 0, hitF = -1, hitB = false;

  /** cast one ray through screen units (X, Y) (pivot-relative, pre-mirror) */
  function cast(X: number, Y: number): boolean {
    // orthographic: start well in front of the pivot, look along camera z
    const ox = piv[0] + X * M[0] + Y * M[3] - 8 * M[6];
    const oy = piv[1] + X * M[1] + Y * M[4] - 8 * M[7];
    const oz = piv[2] + X * M[2] + Y * M[5] - 8 * M[8];
    const dx = M[6], dy = M[7], dz = M[8];
    let best = Infinity, bAxis = -1, bSign = 0, bBar = -1;
    for (let b = 0; b < 3; b++) {
      const o = b * 6;
      let tmin = -Infinity, tmax = Infinity, ax = -1, sg = 0;
      // x slab
      if (Math.abs(dx) < 1e-12) { if (ox < box[o] || ox > box[o + 3]) continue; }
      else {
        const t1 = (box[o] - ox) / dx, t2 = (box[o + 3] - ox) / dx;
        const n = t1 < t2 ? t1 : t2, f = t1 < t2 ? t2 : t1;
        if (n > tmin) { tmin = n; ax = 0; sg = t1 < t2 ? -1 : 1; }
        if (f < tmax) tmax = f;
      }
      if (Math.abs(dy) < 1e-12) { if (oy < box[o + 1] || oy > box[o + 4]) continue; }
      else {
        const t1 = (box[o + 1] - oy) / dy, t2 = (box[o + 4] - oy) / dy;
        const n = t1 < t2 ? t1 : t2, f = t1 < t2 ? t2 : t1;
        if (n > tmin) { tmin = n; ax = 1; sg = t1 < t2 ? -1 : 1; }
        if (f < tmax) tmax = f;
      }
      if (Math.abs(dz) < 1e-12) { if (oz < box[o + 2] || oz > box[o + 5]) continue; }
      else {
        const t1 = (box[o + 2] - oz) / dz, t2 = (box[o + 5] - oz) / dz;
        const n = t1 < t2 ? t1 : t2, f = t1 < t2 ? t2 : t1;
        if (n > tmin) { tmin = n; ax = 2; sg = t1 < t2 ? -1 : 1; }
        if (f < tmax) tmax = f;
      }
      if (tmin > tmax || tmax < 0 || ax < 0) continue;
      if (tmin < best) { best = tmin; bAxis = ax; bSign = sg; bBar = b; }
    }
    if (bBar < 0) return false;
    // position along the hit bar (0 at its start corner, 1 at its end)
    const L1 = 1 + w;
    const p = bBar === 0 ? ox + best * dx : bBar === 1 ? oy + best * dy : oz + best * dz;
    let u = p / L1; if (u < 0) u = 0; else if (u > 1) u = 1;
    hitF = bAxis * 2 + (bSign > 0 ? 1 : 0);
    // the base: bar 1's two long faces (+z over +x on screen) and bar 0's end
    // cap under the C1 corner (the +x band's far end). Shaded like the logo's
    // base, not by face family: two equal-weight crossing ramps, the upper
    // band full at C2 (left, mirrored) fading out toward C1, the lower band
    // the reverse; a small lift on the upper band keeps the seam readable
    // where the ramps cross
    hitB = bBar === 1 ? bAxis !== 1 : bBar === 0 && hitF === 1;
    if (hitB) {
      const up = bAxis === 2;
      let g = bBar === 0 ? 1 : up ? u : 1 - u;
      g = g * g * (3 - 2 * g);
      hitV = 0.17 + 0.76 * g + (up ? 0.05 : 0);
      return true;
    }
    // crossed gradients (see header): family z peaks at C1, x at C2, y at the seam
    let g: number;
    if (bAxis === bBar) g = 0; // end cap
    else if (bBar === 0) g = bAxis === 2 ? u : 1 - u;
    else g = bAxis === 0 ? 1 - u : u;
    const lit = face[hitF];
    let v = 0.2 + 0.45 * lit + 0.33 * g;
    if (v > 0.999) v = 0.999;
    hitV = v;
    return true;
  }

  /* the base's rows for this frame (px): seam y = bSy0 + bK*x, the top edge
     of its upper face y = bTy0 + bK*x, and the seam's row line bS (one for
     the whole base, held with a little hysteresis so it never dithers) */
  let bK = 0, bSy0 = 0, bTy0 = 0, bS = NaN, bCellH = 0;
  let rOx = 0, rOy = 0, rInv = 1;

  /**
   * One sample at (sx, sy) px. Sides cast as they are. The base keeps to
   * whole rows: inside its band a base hit (or a miss) is re-cast with the
   * true seam slid onto the band's row line, so both faces fill their rows
   * straight and edge to edge; above the band a base hit is replaced by
   * whatever borders the face's top edge from above (the side bar running
   * down to the band, or the hole).
   */
  function sample(sx: number, sy: number, inBand: boolean): boolean {
    const X = (MIRROR ? rOx - sx : sx - rOx) * rInv;
    if (inBand) return cast(X, (sy + bSy0 + bK * sx - bS - rOy) * rInv);
    if (!cast(X, (sy - rOy) * rInv)) return false;
    return !hitB || (cast(X, (bTy0 + bK * sx - 0.5 - rOy) * rInv) && !hitB);
  }

  /**
   * Rasterise into the grid. (ox, oy): pivot in px; ks: px per unit.
   * Lens: centre (lx, ly) px, strength la (0..1), radius LR px.
   */
  function raster(g: PenroseGrid, ox: number, oy: number, ks: number, lx: number, ly: number, la: number, LR: number) {
    const { cols, rows, cellW, cellH, kind, lbuf, lens } = g;
    // bbox of the figure in cells
    const bb = bbTmp; bounds(bb);
    const c0 = Math.max(0, Math.floor((ox + bb.x0 * ks) / cellW) - 1);
    const c1 = Math.min(cols - 1, Math.ceil((ox + bb.x1 * ks) / cellW) + 1);
    const r0 = Math.max(0, Math.floor((oy + bb.y0 * ks) / cellH) - 1);
    const r1 = Math.min(rows - 1, Math.ceil((oy + bb.y1 * ks) / cellH) + 1);
    const inv = 1 / ks;
    rOx = ox; rOy = oy; rInv = inv;
    const useLens = la > 0.02, LR2 = LR * LR;
    const qx = cellW * 0.25, qy = cellH * 0.25;
    // the base's seam and top edge in px, and its faces' height in whole rows
    project(1 + w, 0, w, pt); const sxa = ox + pt[0] * ks, sya = oy + pt[1] * ks;
    project(1 + w, 1 + w, w, pt); const sxb = ox + pt[0] * ks;
    bK = (oy + pt[1] * ks - sya) / (sxb - sxa || 1e-9); bSy0 = sya - bK * sxa;
    project(1, 0, w, pt); bTy0 = oy + pt[1] * ks - bK * (ox + pt[0] * ks);
    project(1 + w, 0, 0, pt);
    const bandK = Math.max(1, Math.round((oy + pt[1] * ks - bK * (ox + pt[0] * ks) - bSy0) / cellH));
    // one row line for the whole seam, from its midpoint: the sway rolls the
    // base about its middle, so it stays put and both bands run straight
    const sMid = bSy0 + bK * (sxa + sxb) / 2;
    if (bCellH !== cellH || !(Math.abs(sMid - bS) < 0.62 * cellH)) bS = Math.round(sMid / cellH) * cellH;
    bCellH = cellH;
    const bTop = bS - bandK * cellH, bBot = bS + bandK * cellH;
    for (let r = r0; r <= r1; r++) {
      let lo = 32767, hi = -1;
      const cyc = (r + 0.5) * cellH;
      for (let c = c0; c <= c1; c++) {
        const cxc = (c + 0.5) * cellW;
        let lk = 0, m = 1;
        if (useLens) {
          const ddx = cxc - lx, ddy = cyc - ly, d2 = ddx * ddx + ddy * ddy;
          if (d2 < LR2) { lk = (1 - d2 / LR2) * la; m = 1 / (1 + 0.07 * lk * lk); }
        }
        // cell centre (through the lens): the figure stands on the band's
        // bottom row line, nothing hangs below it
        const ccx = m !== 1 ? lx + (cxc - lx) * m : cxc, ccy = m !== 1 ? ly + (cyc - ly) * m : cyc;
        if (ccy >= bBot) continue;
        const band = ccy >= bTop;
        // nb/ns: base/other hits
        let n = 0, nb = 0, sum = 0, sumS = 0, vmin = 1, f0 = -1, crease = false;
        for (let s = 0; s < 4; s++) {
          let sx = cxc + (s & 1 ? qx : -qx), sy = cyc + (s & 2 ? qy : -qy);
          if (m !== 1) { sx = lx + (sx - lx) * m; sy = ly + (sy - ly) * m; }
          if (!sample(sx, sy, band)) continue;
          n++; sum += hitV; if (hitV < vmin) vmin = hitV;
          if (hitB) nb++; else sumS += hitV;
          if (f0 < 0) f0 = hitF; else if (hitF !== f0) crease = true;
        }
        if (!n) continue;
        const i = r * cols + c;
        // face creases read as a darker seam line; partial cells as softer edge glyphs
        let v = crease ? vmin * 0.82 : sum / n;
        if (n < 4) v *= 0.62 + 0.095 * n;
        // ...except on the base (only ever in its band): its faces keep to
        // whole cells, and where a side face meets it the centre picks one
        // whole value, so the slanted joins step a cell at a time, never dip
        if (nb) {
          const ns = n - nb;
          if (ns && sample(ccx, ccy, true) && !hitB) v = sumS / ns;
          else v = (sum - sumS) / nb;
        }
        v += lk * 0.08;
        lbuf[i] = v > 0.999 ? 0.999 : v;
        kind[i] = 2;
        lens[i] = lk > 0.3 + 0.5 * (((i * 2654435761) >>> 0) / 4294967296) ? 1 : 0;
        if (c < lo) lo = c;
        if (c > hi) hi = c;
      }
      // reserve the hole (and any gap between the bars) so the wall stays out
      if (hi > lo) {
        const base = r * cols;
        for (let c = lo + 1; c < hi; c++) if (kind[base + c] === 0) kind[base + c] = 3;
      }
    }
  }
  const bbTmp: PenroseBox = { x0: 0, x1: 0, y0: 0, y1: 0 };

  setBar(w);
  pose(0, true, 0, 0);

  return {
    setBar,
    pose,
    extents,
    raster,
  };
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
