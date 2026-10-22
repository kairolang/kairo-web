/**
 * KAIRO // ASCII - odometer counters and ASCII progress bars.
 *
 *   import { countTo, asciiBar, animateBar, bindCounters } from '@/lib/ascii/counter';
 *   asciiBar(62)                       // "[██████░░░░] 62%"
 *   asciiBar(62, { cells: 20, label: false })  // "[████████████░░░░░░░░]"
 *   await countTo(el, 130, { duration: 700 });
 *   await animateBar(el, 62, { cells: 16 });
 *
 * Markup auto-binding (wired globally by initAscii()):
 *   <span data-count-to="130">130</span>      ticks 0 -> 130 when first visible
 *     data-count-from="0" data-count-duration="600" (max 900) data-count-decimals="1"
 *     data-count-pad="3"  (zero-pad: 007)    data-count-suffix="%"
 *   <span data-ascii-bar="62" data-bar-cells="16"></span>   fills when first visible
 *
 * Put the FINAL value in the markup (SEO / no-JS / reduced motion show it).
 * Counters update on a stepped clock (~25 fps) so digits "tick", not blur.
 */
import { onceVisible, reducedMotion, stillPage } from './motion';

export interface BarOptions {
  cells?: number;     // default 10
  fill?: string;      // default '█'
  empty?: string;     // default '░'
  label?: boolean;    // append " 62%". default true
  brackets?: boolean; // wrap in [ ]. default true
}

export function asciiBar(pct: number, o: BarOptions = {}): string {
  const { cells = 10, fill = '█', empty = '░', label = true, brackets = true } = o;
  const p = Math.max(0, Math.min(100, pct));
  const n = Math.round((p / 100) * cells);
  const bar = fill.repeat(n) + empty.repeat(cells - n);
  const body = brackets ? `[${bar}]` : bar;
  return label ? `${body} ${String(Math.round(p)).padStart(3, ' ')}%` : body;
}

export interface CountOptions {
  from?: number;
  duration?: number; // ms, default 600
  decimals?: number;
  pad?: number;      // zero-pad integer part to this many digits
  suffix?: string;
  prefix?: string;
  fps?: number;      // tick rate, default 25
}

function fmt(v: number, o: CountOptions): string {
  const d = o.decimals ?? 0;
  let s = v.toFixed(d);
  if (o.pad) {
    const [i, f] = s.split('.');
    s = i.padStart(o.pad, '0') + (f ? '.' + f : '');
  }
  return (o.prefix ?? '') + s + (o.suffix ?? '');
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

function tween(duration: number, fps: number, onStep: (p: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = -Infinity;
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      if (now - last >= 1000 / fps || p === 1) { last = now; onStep(p); }
      if (p < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export function countTo(el: HTMLElement, to: number, o: CountOptions = {}): Promise<void> {
  const from = o.from ?? 0;
  if (reducedMotion()) { el.textContent = fmt(to, o); return Promise.resolve(); }
  return tween(o.duration ?? 600, o.fps ?? 25, (p) => {
    el.textContent = fmt(p === 1 ? to : from + (to - from) * easeOut(p), o);
  });
}

export function animateBar(el: HTMLElement, pct: number, o: BarOptions & { duration?: number } = {}): Promise<void> {
  if (reducedMotion()) { el.textContent = asciiBar(pct, o); return Promise.resolve(); }
  const cells = o.cells ?? 10;
  // one tick per cell: chunky, terminal-like
  return tween(o.duration ?? Math.min(600, 40 * cells), Math.max(12, cells * 2), (p) => {
    el.textContent = asciiBar(pct * easeOut(p), o);
  });
}

export function bindCounters(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-count-to]:not([data-count-bound])').forEach((el) => {
    el.setAttribute('data-count-bound', '');
    const to = parseFloat(el.dataset.countTo || '0');
    const opts: CountOptions = {
      from: parseFloat(el.dataset.countFrom || '0') || 0,
      duration: Math.min(900, parseInt(el.dataset.countDuration || '', 10) || 600),
      decimals: parseInt(el.dataset.countDecimals || '', 10) || 0,
      pad: parseInt(el.dataset.countPad || '', 10) || 0,
      suffix: el.dataset.countSuffix || '',
      prefix: el.dataset.countPrefix || '',
    };
    if (stillPage()) { el.textContent = fmt(to, opts); return; }
    el.textContent = fmt(opts.from ?? 0, opts);
    onceVisible(el, () => { void countTo(el, to, opts); });
  });
  root.querySelectorAll<HTMLElement>('[data-ascii-bar]:not([data-bar-bound])').forEach((el) => {
    el.setAttribute('data-bar-bound', '');
    const pct = parseFloat(el.dataset.asciiBar || '0');
    const o: BarOptions = {
      cells: parseInt(el.dataset.barCells || '', 10) || 10,
      label: el.dataset.barLabel !== 'off',
    };
    if (stillPage()) { el.textContent = asciiBar(pct, o); return; }
    el.textContent = asciiBar(0, o);
    onceVisible(el, () => { void animateBar(el, pct, o); });
  });
}
