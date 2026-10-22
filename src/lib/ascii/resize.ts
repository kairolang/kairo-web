/**
 * KAIRO // ASCII - drag-to-resize for terminal frames (browser only).
 *
 * Two layers:
 *
 * 1. makeResizable(el, opts): the low-level primitive (hero + CodeShowcase use
 *    it directly, with their own apply/reset).
 *
 *      import { makeResizable } from '@/lib/ascii/resize';
 *      const dispose = makeResizable(frame, {
 *        handles: ['sw', 'se', 'e', 'w', 's'],
 *        anchor: 'center',
 *        apply: (w, h) => { frame.style.width = w + 'px'; },
 *        reset: () => { frame.style.width = ''; },
 *      });
 *
 * 2. bindResizable(root?): the site-wide auto binder (BaseLayout calls it on
 *    every non-docs page). It gives every ASCII box corner grips and reflows
 *    the surrounding layout live. See DESIGN.md "Resizable boxes".
 *      auto-bound:  [data-resizable] (not ="false"/"off"), .ascii-frame,
 *                   .card, .code-window, .code-block-wrap (blog code blocks)
 *      skipped:     <html data-resize="off"> (docs), anything inside
 *                   [data-resize-scope="off"] or .site-header, anything inside
 *                   a box that a component bound by hand, scroll containers,
 *                   absolute/fixed/sticky boxes, inline boxes.
 *      per box:     data-resize-axis="x|y|both" (or data-resizable="x|y"),
 *                   data-resize-min="W" | "WxH", data-resize-max="W" | "WxH",
 *                   data-resize-anchor="start|center|end",
 *                   data-resize-readout="off",
 *                   data-resize-label="name" (grip aria-label; else aria-label/title)
 *      container:   data-reflow="flex|grid|grid-span|none" on the PARENT
 *                   (auto-detected from computed display when absent)
 *
 * Styles live in src/styles/global.css (".rz-*"); src/styles/resize.css is
 * the older per-component copy and stays compatible. Handles:
 *   - corners (sw, se) are real <button>s: focusable, aria-labelled; arrow keys
 *     resize (Shift = bigger steps), Home or double-click resets.
 *   - edges (e, w, s) are pointer-only strips (aria-hidden, not in tab order).
 * Pointer events + setPointerCapture (mouse / touch / pen); Escape cancels a
 * drag. Only the grips set touch-action:none, so page scrolling is never
 * hijacked. Moves are coalesced to one apply() per animation frame. apply()
 * should only WRITE styles; read layout from a ResizeObserver if you need
 * the result, so a drag never forces a synchronous layout.
 *
 * While a box is being resized, section scroll-snap is suspended
 * (html.rz-dragging), and stays suspended (html.rz-snap-hold) until the
 * user's next scroll settles, so the page never jumps after a resize.
 *
 * Sizes are border-box px of `el`. `axis()` is evaluated when a drag starts,
 * so the default (vertical only below 640px) follows the viewport.
 */

export type ResizeHandle = 'se' | 'sw' | 'e' | 'w' | 's';
export type ResizeAxis = 'both' | 'x' | 'y' | 'none';
export type ResizePhase = 'start' | 'move' | 'end' | 'reset';
export type ResizeAnchor = 'start' | 'center' | 'end';

export interface ResizableOptions {
  /** which grips to render (default: sw, se, e, w, s; a static 'start' anchor drops sw/w) */
  handles?: ResizeHandle[];
  /**
   * 'start': left edge fixed. 'center': element is centred, width grows on
   * both sides (grips move 2x). 'end': right edge fixed. A function is
   * evaluated at each drag start (and all handles are kept; CSS hides the
   * left grips while host[data-rz-anchor="start"]).
   */
  anchor?: ResizeAnchor | (() => ResizeAnchor);
  /** element the grips are appended to (default: el; must be positioned) */
  host?: HTMLElement;
  /** human name for aria-labels, e.g. "code window" */
  label?: string;
  minWidth?: number | (() => number);
  maxWidth?: number | (() => number);
  minHeight?: number | (() => number);
  maxHeight?: number | (() => number);
  /** allowed axes, evaluated per drag (default: y below 640px, else both) */
  axis?: () => ResizeAxis;
  /** current border-box size; default reads el.getBoundingClientRect() (once per drag) */
  measure?: () => { width: number; height: number };
  /** write the new size. `dw`/`dh`: whether that axis moved during this gesture */
  apply: (w: number, h: number, dw: boolean, dh: boolean) => void;
  /** drop the custom size (double-click / Home) */
  reset: () => void;
  /** Escape / pointercancel: restore the pre-drag state (default: apply(w0, h0)) */
  cancel?: () => void;
  /** called after each apply / reset */
  onChange?: (w: number, h: number, phase: ResizePhase) => void;
  /** text for the size readout ("80×24"); omit for no readout */
  readout?: (w: number, h: number) => string;
  /** keyboard step in px (default 8; Shift = 6×) */
  step?: number;
  /** corners that are keyboard-focusable <button>s (default: every corner). Others are pointer-only. */
  keyboard?: ResizeHandle[];
  /** shared polite live region (default: one per host) */
  live?: HTMLElement;
  /** internal: bound by bindResizable() (adds .rz-auto; yields to a hand-made binding) */
  auto?: boolean;
}

const val = (v: number | (() => number) | undefined, d: number) =>
  v === undefined ? d : typeof v === 'function' ? v() : v;

const LABELS: Record<ResizeHandle, string> = {
  se: 'bottom-right corner',
  sw: 'bottom-left corner',
  e: 'right edge',
  w: 'left edge',
  s: 'bottom edge',
};

/** el -> dispose(), so a hand-made binding can replace an auto one (either order) */
const registry = new WeakMap<HTMLElement, () => void>();

/* ── scroll-snap hold ────────────────────────────────────────────────
   Snap is off while html.rz-dragging (pointer drags). After any resize we
   keep it off (html.rz-snap-hold) until the user next scrolls and that scroll
   settles: re-enabling snap with no scroll in flight could make the browser
   re-snap and jump the page under the user's hands. */
const SCROLL_KEYS = new Set([' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp']);
let holdIntent: ((e: Event) => void) | null = null;
let holdSettle: (() => void) | null = null;
let holdT = 0;

function clearHold() {
  if (holdIntent) {
    for (const t of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(t, holdIntent, true);
    holdIntent = null;
  }
  if (holdSettle) { window.removeEventListener('scroll', holdSettle); holdSettle = null; }
  if (holdT) { clearTimeout(holdT); holdT = 0; }
}

export function holdSnap(): void {
  const d = document.documentElement;
  if (!d.hasAttribute('data-scroll-snap')) return;
  clearHold();
  d.classList.add('rz-snap-hold');
  const done = () => { clearHold(); d.classList.remove('rz-snap-hold'); };
  holdIntent = (e: Event) => {
    if (e.type === 'keydown') {
      const k = (e as KeyboardEvent).key;
      const t = e.target as HTMLElement | null;
      if (!SCROLL_KEYS.has(k) || (t && t.closest?.('input, textarea, select, [contenteditable], .rz-handle'))) return;
    }
    if (holdIntent) for (const t of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(t, holdIntent, true);
    holdIntent = null;
    // release once this user scroll has been idle for a moment
    holdSettle = () => { if (holdT) clearTimeout(holdT); holdT = window.setTimeout(done, 180); };
    window.addEventListener('scroll', holdSettle, { passive: true });
    holdSettle();
  };
  for (const t of ['wheel', 'touchstart', 'keydown'] as const) {
    window.addEventListener(t, holdIntent, { capture: true, passive: true });
  }
}

export function makeResizable(el: HTMLElement, opts: ResizableOptions): () => void {
  // replace an earlier binding of the same element (auto or hand-made)
  registry.get(el)?.();
  // a hand-made binding owns its subtree: drop auto grips inside it
  if (!opts.auto) el.querySelectorAll<HTMLElement>('.rz-auto').forEach((n) => registry.get(n)?.());

  const host = opts.host ?? el;
  const anchorOpt = opts.anchor ?? 'start';
  const dynamicAnchor = typeof anchorOpt === 'function';
  const name = opts.label ?? 'panel';
  const step = opts.step ?? 8;
  const axisOf = opts.axis ?? (() => (window.innerWidth < 640 ? 'y' : 'both'));
  let handles = opts.handles ?? ['sw', 'se', 'e', 'w', 's'];
  if (anchorOpt === 'start') handles = handles.filter((h) => h !== 'sw' && h !== 'w');
  const keyboard = opts.keyboard ?? ['se', 'sw'];
  let anchor: ResizeAnchor = dynamicAnchor ? 'start' : anchorOpt;

  host.classList.add('rz-host');
  if (opts.auto) host.classList.add('rz-auto');
  const made: HTMLElement[] = [];
  let readout: HTMLElement | null = null;
  if (opts.readout) {
    readout = document.createElement('span');
    readout.className = 'rz-readout';
    readout.setAttribute('aria-hidden', 'true');
    host.appendChild(readout);
    made.push(readout);
  }
  // polite live region so keyboard users hear the new size
  let live = opts.live;
  if (!live) {
    live = document.createElement('span');
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    host.appendChild(live);
    made.push(live);
  }
  const say = (t: string) => { live!.textContent = t; };

  /* gesture state (no allocations during a drag) */
  let active: ResizeHandle | null = null;
  let pid = -1;
  let x0 = 0, y0 = 0, w0 = 0, h0 = 0;
  let px = 0, py = 0;
  let axis: ResizeAxis = 'both';
  let minW = 0, maxW = 1e5, minH = 0, maxH = 1e5;
  let curW = 0, curH = 0;
  let movedW = false, movedH = false;
  let raf = 0;
  let fadeT = 0;

  const showReadout = (w: number, h: number) => {
    if (!readout || !opts.readout) return;
    readout.textContent = opts.readout(w, h);
    readout.classList.add('is-on');
    if (fadeT) { clearTimeout(fadeT); fadeT = 0; }
  };
  const hideReadout = (delay = 700) => {
    if (!readout) return;
    if (fadeT) clearTimeout(fadeT);
    fadeT = window.setTimeout(() => { readout!.classList.remove('is-on'); fadeT = 0; }, delay);
  };

  function begin(h: ResizeHandle) {
    axis = axisOf();
    const m = opts.measure ? opts.measure() : el.getBoundingClientRect();
    if (dynamicAnchor) host.dataset.rzAnchor = anchor = (anchorOpt as () => ResizeAnchor)();
    w0 = curW = m.width; h0 = curH = m.height;
    // a box already smaller than its floor never jumps on the first move
    minW = Math.min(val(opts.minWidth, 120), w0); maxW = Math.max(minW, val(opts.maxWidth, 1e5));
    minH = Math.min(val(opts.minHeight, 80), h0); maxH = Math.max(minH, val(opts.maxHeight, 1e5));
    movedW = movedH = false;
    active = h;
    host.classList.add('is-resizing');
    host.dataset.rzHandle = h;
  }

  /** dx/dy are handle displacement in px */
  function target(dx: number, dy: number) {
    const h = active!;
    const k = anchor === 'center' ? 2 : 1;
    let w = w0, hh = h0;
    if (axis === 'both' || axis === 'x') {
      // an 'end'-anchored box's right edge is pinned (its left edge moves), so
      // the right-side grips would pull the box the wrong way: they go
      // height-only there and width is left to sw/w, which track the pointer
      if (h === 'se' || h === 'e') { if (anchor !== 'end') w = w0 + dx * k; }
      else if (h === 'sw' || h === 'w') w = w0 - dx * k;
    }
    if (axis === 'both' || axis === 'y') {
      if (h === 'se' || h === 'sw' || h === 's') hh = h0 + dy;
    }
    curW = Math.round(Math.min(maxW, Math.max(minW, w)));
    curH = Math.round(Math.min(maxH, Math.max(minH, hh)));
    if (Math.abs(curW - w0) > 1) movedW = true;
    if (Math.abs(curH - h0) > 6) movedH = true; // a corner drag shouldn't lock height by jitter
  }

  function commit(phase: ResizePhase) {
    opts.apply(curW, curH, movedW, movedH);
    opts.onChange?.(curW, curH, phase);
    showReadout(curW, curH);
  }

  const frame = () => {
    raf = 0;
    if (!active) return;
    target(px - x0, py - y0);
    commit('move');
  };

  function finish() {
    active = null;
    host.classList.remove('is-resizing');
    delete host.dataset.rzHandle;
  }

  function end(cancel: boolean) {
    if (!active) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (cancel && opts.cancel) {
      curW = w0; curH = h0;
      opts.cancel();
      opts.onChange?.(curW, curH, 'end');
    } else {
      if (cancel) { curW = w0; curH = h0; }
      else target(px - x0, py - y0);
      commit('end');
    }
    finish();
    document.documentElement.classList.remove('rz-dragging');
    document.documentElement.style.removeProperty('--rz-cursor');
    window.removeEventListener('keydown', onEsc, true);
    holdSnap();
    hideReadout();
  }

  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && active) { e.preventDefault(); e.stopPropagation(); end(true); }
  };

  function doReset() {
    if (active) end(true);
    holdSnap();
    opts.reset();
    const m = opts.measure ? opts.measure() : el.getBoundingClientRect();
    opts.onChange?.(m.width, m.height, 'reset');
    if (readout) readout.classList.remove('is-on');
    say(`${name} size reset`);
  }

  const cursorOf = (h: ResizeHandle) =>
    h === 'se' ? 'nwse-resize' : h === 'sw' ? 'nesw-resize' : h === 's' ? 'ns-resize' : 'ew-resize';

  const offs: Array<() => void> = [];
  const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement, ev: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
    t.addEventListener(ev, fn as EventListener, o);
    offs.push(() => t.removeEventListener(ev, fn as EventListener, o));
  };

  for (const h of handles) {
    const corner = h === 'se' || h === 'sw';
    const keys = corner && keyboard.includes(h);
    const g = document.createElement(keys ? 'button' : 'span');
    g.className = `rz-handle rz-handle--${h}${corner ? ' rz-corner' : ' rz-edge'}`;
    g.dataset.rz = h;
    g.draggable = false;
    if (keys) {
      (g as HTMLButtonElement).type = 'button';
      g.setAttribute('aria-label', `Resize ${name} from the ${LABELS[h]}. Arrow keys resize, Shift for larger steps, Home to reset.`);
      g.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Home');
      g.title = 'Drag to resize · double-click to reset';
    } else {
      g.setAttribute('aria-hidden', 'true');
      if (corner) g.title = 'Drag to resize · double-click to reset';
    }
    host.appendChild(g);
    made.push(g);

    on(g, 'pointerdown', (e: PointerEvent) => {
      if (e.button !== 0 || active) return;
      e.stopPropagation();
      begin(h);
      if (axis === 'none' || (axis === 'y' && (h === 'e' || h === 'w'))) { finish(); return; }
      e.preventDefault();
      pid = e.pointerId;
      try { g.setPointerCapture(pid); } catch { /* ignore */ }
      x0 = px = e.clientX; y0 = py = e.clientY;
      document.documentElement.classList.add('rz-dragging');
      document.documentElement.style.setProperty('--rz-cursor', axis === 'y' ? 'ns-resize' : cursorOf(h));
      window.addEventListener('keydown', onEsc, true);
      opts.onChange?.(curW, curH, 'start');
      showReadout(curW, curH);
    });
    on(g, 'pointermove', (e: PointerEvent) => {
      if (!active || e.pointerId !== pid) return;
      px = e.clientX; py = e.clientY;
      if (!raf) raf = requestAnimationFrame(frame);
    });
    const up = (e: PointerEvent) => {
      if (!active || e.pointerId !== pid) return;
      px = e.clientX; py = e.clientY;
      try { g.releasePointerCapture(pid); } catch { /* ignore */ }
      pid = -1;
      end(e.type === 'pointercancel');
    };
    on(g, 'pointerup', up);
    on(g, 'pointercancel', up);
    on(g, 'lostpointercapture', (e: PointerEvent) => { if (active && e.pointerId === pid) { pid = -1; end(false); } });
    // grips may sit inside a link/card: never let a grip click navigate or toggle
    on(g, 'click', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); });
    on(g, 'dragstart', (e: DragEvent) => { e.preventDefault(); });
    on(g, 'dblclick', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); doReset(); });

    if (keys) {
      on(g, 'keydown', (e: KeyboardEvent) => {
        if (e.key === 'Home') { e.preventDefault(); doReset(); return; }
        let dx = 0, dy = 0;
        const s = e.shiftKey ? step * 6 : step;
        if (e.key === 'ArrowLeft') dx = -s;
        else if (e.key === 'ArrowRight') dx = s;
        else if (e.key === 'ArrowUp') dy = -s;
        else if (e.key === 'ArrowDown') dy = s;
        else return;
        e.preventDefault();
        e.stopPropagation();
        if (active) return;
        begin(h);
        if (axis === 'none') { finish(); return; }
        // arrows move the grip itself; for a centred frame that is half the width change
        target(anchor === 'center' ? dx / 2 : dx, dy);
        commit('end');
        finish();
        holdSnap();
        say(opts.readout ? opts.readout(curW, curH) : `${curW} by ${curH}`);
        hideReadout(900);
      });
    }
  }

  const dispose = () => {
    if (active) end(true);
    if (raf) cancelAnimationFrame(raf);
    if (fadeT) clearTimeout(fadeT);
    offs.forEach((f) => f());
    made.forEach((n) => n.remove());
    host.classList.remove('rz-host', 'rz-auto', 'is-resizing', 'rz-host--outside');
    for (const v of ['--rz-bb', '--rz-br', '--rz-bl']) host.style.removeProperty(v);
    delete host.dataset.rzAnchor;
    if (registry.get(el) === dispose) registry.delete(el);
  };
  registry.set(el, dispose);
  return dispose;
}

/* ═══════════════════════════════════════════════════════════════════
   Site-wide auto binding
   ═══════════════════════════════════════════════════════════════════ */

export const RESIZABLE_SELECTOR =
  '[data-resizable]:not([data-resizable="false"]):not([data-resizable="off"]),' +
  '.ascii-frame:not([data-resizable]), .card:not([data-resizable]), .code-window:not([data-resizable]),' +
  '.code-block-wrap:not([data-resizable])';

type Mode = 'block' | 'flex' | 'grid' | 'span';

const px = (v: string | null | undefined) => parseFloat(v || '') || 0;

/** "240" -> {w:240}; "240x160" -> {w:240,h:160}; "x160" -> {h:160} */
function parseWH(s: string | undefined): { w?: number; h?: number } {
  if (!s) return {};
  const [a, b] = s.toLowerCase().split(/[x×\s,]+/);
  const w = parseFloat(a), h = parseFloat(b);
  return { w: Number.isFinite(w) ? w : undefined, h: Number.isFinite(h) ? h : undefined };
}

/** resolved px tracks of a computed grid-template-columns (line names dropped) */
function parseTracks(tpl: string): number[] {
  const out: number[] = [];
  if (!tpl || tpl === 'none') return out;
  for (const tok of tpl.split(/\s+/)) if (/^-?[\d.]+px$/.test(tok)) out.push(parseFloat(tok));
  return out;
}

/** a real flex item, not a grip/readout/live region injected into a host */
const isFlexItem = (k: Element) =>
  !k.classList.contains('rz-handle') && !k.classList.contains('rz-readout') && !k.classList.contains('sr-only');

const isLayout = (cs: CSSStyleDeclaration) =>
  cs.display.endsWith('grid') || (cs.display.endsWith('flex') && cs.flexDirection.startsWith('row'));

/* inline-style bookkeeping: the first save of a property wins (it holds the
   author's original inline value), shared by every box touching that element */
const saved = new WeakMap<HTMLElement, Map<string, string>>();
function setS(t: HTMLElement, prop: string, v: string, mine: Map<HTMLElement, Set<string>>) {
  let m = saved.get(t);
  if (!m) saved.set(t, (m = new Map()));
  if (!m.has(prop)) m.set(prop, t.style.getPropertyValue(prop));
  let s = mine.get(t);
  if (!s) mine.set(t, (s = new Set()));
  s.add(prop);
  t.style.setProperty(prop, v);
}
function restoreS(t: HTMLElement, prop: string) {
  const m = saved.get(t);
  if (!m || !m.has(prop)) return;
  const v = m.get(prop)!;
  m.delete(prop);
  if (v) t.style.setProperty(prop, v); else t.style.removeProperty(prop);
}

/** boxes whose grid tracks are pinned: reset them when the viewport width changes */
const viewportResets = new Set<() => void>();
let viewportBound = false;
let lastVW = 0;
function bindViewport() {
  if (viewportBound) return;
  viewportBound = true;
  lastVW = window.innerWidth;
  let t = 0;
  window.addEventListener('resize', () => {
    if (t) clearTimeout(t);
    t = window.setTimeout(() => {
      t = 0;
      if (Math.abs(window.innerWidth - lastVW) < 2) return; // mobile URL-bar height changes
      lastVW = window.innerWidth;
      viewportResets.forEach((f) => f());
    }, 150);
  }, { passive: true });
}

let sharedLive: HTMLElement | null = null;
function liveRegion(): HTMLElement {
  if (sharedLive && sharedLive.isConnected) return sharedLive;
  sharedLive = document.createElement('span');
  sharedLive.className = 'sr-only';
  sharedLive.id = 'rz-live';
  sharedLive.setAttribute('aria-live', 'polite');
  document.body.appendChild(sharedLive);
  return sharedLive;
}

function bindAuto(el: HTMLElement, inLink: boolean, live: HTMLElement, label: string) {
  const spec = (el.dataset.resizeAxis || el.dataset.resizable || '').toLowerCase();
  const pref: ResizeAxis = spec === 'x' ? 'x' : spec === 'y' ? 'y' : 'both';
  const minS = parseWH(el.dataset.resizeMin);
  const maxS = parseWH(el.dataset.resizeMax);
  const anchorAttr = el.dataset.resizeAnchor as ResizeAnchor | undefined;

  /* per-gesture context, resolved at drag start (reads only) */
  let tgt: HTMLElement = el; // the layout item whose width is written
  let parent: HTMLElement | null = null;
  let mode: Mode = 'block';
  let anchor: ResizeAnchor = 'start';
  let contentW = 0, gap = 0, trackW = 0, nTracks = 0, maxGridW = 0, span = 1;
  let gPre = '', gPost = '';
  let natH = 0, charW = 8, lineH = 20, padX = 0, padY = 0;
  /* flex row: siblings share one line -> keep it one line, never shrink a
     sibling (or this item) below its min-content */
  let oneRow = false, sibMin = 0, ownMin = 0;
  const items: HTMLElement[] = [];
  let cssBefore = '', cssParentBefore = '';
  /** every inline property this box has written, per element */
  const mine = new Map<HTMLElement, Set<string>>();

  const resolve = () => {
    tgt = el;
    parent = el.parentElement;
    let pcs = parent ? getComputedStyle(parent) : null;
    // a lone wrapper (<li><a class="ascii-frame">) is the real layout item
    if (parent && pcs && parent.childElementCount === 1 && parent.parentElement && parent !== document.body && !parent.dataset.reflow) {
      const gcs = getComputedStyle(parent.parentElement);
      if (isLayout(gcs)) { tgt = parent; parent = parent.parentElement; pcs = gcs; }
    }
    const reflow = parent?.dataset.reflow || '';
    mode = 'block';
    let tracks: number[] = [];
    if (pcs && reflow !== 'none') {
      if (pcs.display.endsWith('grid')) {
        tracks = parseTracks(pcs.gridTemplateColumns);
        if (tracks.length > 1) mode = reflow === 'grid-span' ? 'span' : 'grid';
      } else if (pcs.display.endsWith('flex') && pcs.flexDirection.startsWith('row')) mode = 'flex';
    }
    oneRow = false;
    items.length = 0;
    if (mode === 'flex' && parent) {
      for (const k of parent.children) if (isFlexItem(k)) items.push(k as HTMLElement);
      if (items.length > 1) {
        const t0 = items[0].getBoundingClientRect().top;
        oneRow = true;
        for (let i = 1; i < items.length; i++) {
          if (Math.abs(items[i].getBoundingClientRect().top - t0) > 1) { oneRow = false; break; }
        }
      }
    }
    const r = el.getBoundingClientRect();
    const tr = tgt === el ? r : tgt.getBoundingClientRect();
    anchor = 'start';
    if (parent && pcs) {
      const pr = parent.getBoundingClientRect();
      const left0 = pr.left + px(pcs.borderLeftWidth) + px(pcs.paddingLeft);
      contentW = Math.max(0, parent.clientWidth - px(pcs.paddingLeft) - px(pcs.paddingRight));
      const lGap = tr.left - left0, rGap = left0 + contentW - tr.right;
      if (mode === 'grid' || mode === 'span') {
        gap = px(pcs.columnGap);
        nTracks = tracks.length;
        trackW = tracks[0];
        // which tracks does the item cover?
        let acc = 0, col = 0;
        for (let i = 0; i < tracks.length; i++) {
          col = i;
          if (lGap < acc + tracks[i] / 2) break;
          acc += tracks[i] + gap;
        }
        let end = col, edge = acc + tracks[col];
        while (end + 1 < tracks.length && tr.right - left0 > edge + gap + tracks[end + 1] / 2) { end++; edge += gap + tracks[end]; }
        span = end - col + 1;
        const minTrack = px(parent.dataset.reflowMin) || 64;
        if (mode === 'grid') {
          const after = tracks.length - 1 - end;
          const fr = 'minmax(0,1fr)';
          if (after > 0) {
            // splitter: columns before stay put, columns after share what's left
            let pre = '', before = 0;
            for (let i = 0; i < col; i++) { pre += tracks[i] + 'px '; before += tracks[i] + gap; }
            gPre = pre;
            gPost = (' ' + fr).repeat(after);
            maxGridW = contentW - before - after * (minTrack + gap);
            anchor = 'start';
          } else {
            // last column: its right edge is the grid's; it grows leftwards
            gPre = (fr + ' ').repeat(col);
            gPost = '';
            maxGridW = contentW - col * (minTrack + gap);
            anchor = col > 0 ? 'end' : 'start';
          }
        }
      } else if (mode === 'block') {
        anchor = lGap > 2 && Math.abs(lGap - rGap) < 2 ? 'center' : 'start';
      }
    }
    if (anchorAttr === 'start' || anchorAttr === 'center' || anchorAttr === 'end') anchor = anchorAttr;
    return r;
  };

  const measure = () => {
    cssBefore = tgt.style.cssText + '\u0000' + el.style.cssText;
    const r = resolve();
    cssParentBefore = parent ? parent.style.cssText : '';
    sibMin = ownMin = 0;
    if (mode === 'flex' && oneRow && parent) {
      // once per gesture (write, read, restore): each item's floor (min-content,
      // or the author's min-width if larger) ...
      const prev = items.map((k) => k.style.cssText);
      for (const k of items) {
        k.style.setProperty('flex', 'none');
        k.style.setProperty('width', 'min-content');
      }
      for (const k of items) {
        const w = k.getBoundingClientRect().width;
        if (k === tgt) ownMin = w; else sibMin += w;
      }
      items.forEach((k, i) => { k.style.cssText = prev[i]; });
      const pcs = getComputedStyle(parent);
      sibMin += px(pcs.columnGap) * (items.length - 1);
      // ... and how wide the row may get: a shrink-wrapped (fit-content) row
      // grows with its items up to its max-width; a fixed/full row does not
      const tPrev = tgt.style.cssText;
      tgt.style.setProperty('flex', `0 0 ${Math.round(r.width) + 4000}px`);
      contentW = Math.max(contentW, parent.clientWidth - px(pcs.paddingLeft) - px(pcs.paddingRight));
      tgt.style.cssText = tPrev;
    }
    const cs = getComputedStyle(el);
    const fs = px(cs.fontSize) || 15;
    charW = fs * 0.6;
    lineH = px(cs.lineHeight) || fs * 1.6;
    padX = px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
    padY = px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    natH = r.height;
    const m = saved.get(el);
    if (mine.get(el)?.has('min-height') && m?.has('min-height')) {
      // natural height: measure once without our min-height
      const cur = el.style.getPropertyValue('min-height');
      const orig = m.get('min-height')!;
      if (orig) el.style.setProperty('min-height', orig); else el.style.removeProperty('min-height');
      natH = el.getBoundingClientRect().height;
      el.style.setProperty('min-height', cur);
    }
    return { width: r.width, height: r.height };
  };

  const reset = () => {
    for (const [t, props] of mine) props.forEach((p) => restoreS(t, p));
    mine.clear();
    viewportResets.delete(reset);
    delete el.dataset.rzSized;
  };

  const touch = () => {
    el.dataset.rzSized = '';
    // pinned tracks / a forced single row: let a viewport change undo them
    if (mode === 'grid' || mode === 'span' || (mode === 'flex' && oneRow)) { bindViewport(); viewportResets.add(reset); }
  };

  makeResizable(el, {
    auto: true,
    live,
    anchor: () => anchor,
    handles: pref === 'x' ? ['sw', 'se', 'e', 'w'] : pref === 'y' ? ['se', 's'] : ['sw', 'se', 'e', 'w', 's'],
    keyboard: inLink ? [] : ['se'],
    label,
    axis: () => {
      const narrow = window.innerWidth < 640;
      if (pref === 'y') return 'y';
      if (pref === 'x') return narrow ? 'none' : 'x';
      return narrow ? 'y' : 'both';
    },
    measure,
    minWidth: () => Math.max(ownMin, minS.w ?? Math.min(160, contentW || 160)),
    maxWidth: () => {
      const cap = mode === 'grid' ? maxGridW
        : mode === 'flex' && oneRow ? Math.max(ownMin, contentW - sibMin)
        : contentW || 1e5;
      return Math.max(0, Math.min(maxS.w ?? 1e5, cap));
    },
    minHeight: () => Math.max(minS.h ?? 0, natH),
    maxHeight: () => maxS.h ?? natH + Math.max(240, window.innerHeight * 0.8),
    apply(w, h, dw, dh) {
      if (dw && parent) {
        if (mode === 'grid') {
          const n = span;
          const per = Math.max(0, (w - (n - 1) * gap) / n);
          setS(parent, 'grid-template-columns', gPre + (n > 1 ? `repeat(${n},${per}px)` : per + 'px') + gPost, mine);
        } else if (mode === 'span') {
          const n = Math.max(1, Math.min(nTracks, Math.round((w + gap) / (trackW + gap))));
          setS(tgt, 'grid-column', `span ${n}`, mine);
          setS(parent, 'grid-auto-flow', 'row dense', mine);
        } else if (mode === 'flex') {
          // a shared row stays one row: the item takes exactly w (capped so every
          // sibling keeps its content width); siblings give up width or a
          // shrink-wrapped row grows, instead of wrapping
          setS(tgt, 'flex', `0 ${oneRow ? 0 : 1} ${w}px`, mine);
          setS(tgt, 'max-width', '100%', mine);
          if (oneRow) setS(parent, 'flex-wrap', 'nowrap', mine);
        } else {
          setS(tgt, 'width', w + 'px', mine);
          setS(tgt, 'max-width', '100%', mine);
        }
      }
      if (dh) setS(el, 'min-height', h + 'px', mine);
      if (dw || dh) touch();
    },
    cancel() {
      const [a, b] = cssBefore.split('\u0000');
      tgt.style.cssText = a;
      if (tgt !== el) el.style.cssText = b;
      if (parent) parent.style.cssText = cssParentBefore;
    },
    reset,
    readout: el.dataset.resizeReadout === 'off'
      ? undefined
      : (w, h) => `${Math.max(1, Math.round((w - padX) / charW))}×${Math.max(1, Math.round((h - padY) / lineH))}`,
  });

  // keep the left grips (sw/w) in sync with the anchor before they're needed
  el.addEventListener('pointerenter', () => {
    if (el.classList.contains('is-resizing') || !registry.has(el)) return;
    resolve();
    el.dataset.rzAnchor = anchor;
  }, { passive: true });
}

const seenLabels = new WeakMap<Document, Map<string, number>>();
const txt = (n: Element | null | undefined) => (n?.textContent || '').replace(/\s+/g, ' ').trim();

/** a human name for a box's grips: its own label, title, language, heading */
function boxLabel(el: HTMLElement): string {
  let l = (el.dataset.resizeLabel || el.getAttribute('aria-label') || '').trim()
    || txt(el.querySelector(':scope > .ascii-frame-title, :scope .code-window-title'));
  if (!l) {
    const lang = txt(el.querySelector(':scope > .code-block-header .code-block-lang'));
    if (lang) l = `${lang} code block`;
  }
  if (!l) l = txt(el.querySelector(':scope > dt, :scope > h2, :scope > h3'));
  if (!l) l = (el.querySelector(':scope > [aria-label]')?.getAttribute('aria-label') || '').trim();
  return (l || 'box').slice(0, 60);
}

/**
 * Give every ASCII box on the page drag grips (idempotent; call again after
 * injecting markup). No-op on <html data-resize="off"> (docs pages).
 */
export function bindResizable(root: ParentNode = document): void {
  const d = document.documentElement;
  if (d.dataset.resize === 'off' || typeof window === 'undefined') return;
  const els = root.querySelectorAll<HTMLElement>(RESIZABLE_SELECTOR);
  const cand: HTMLElement[] = [];
  els.forEach((el) => {
    if (registry.has(el) || el.classList.contains('rz-host')) return;
    if (el.closest('[data-resize-scope="off"], .site-header')) return;
    // inside a box a component bound by hand (hero, showcase): that box owns resizing
    const owner = el.parentElement?.closest('.rz-host:not(.rz-auto)');
    if (owner) return;
    cand.push(el);
  });
  if (!cand.length) return;
  // batch reads, then writes
  const borders: Array<[string, string, string] | null> = [];
  const ok = cand.map((el, i) => {
    const cs = getComputedStyle(el);
    // link boxes get outside grips, flush with the BORDER box (see below)
    borders[i] = el.closest('a, button, summary, label') ? [cs.borderBottomWidth, cs.borderRightWidth, cs.borderLeftWidth] : null;
    if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky') return 0;
    if (cs.display === 'inline' || cs.display === 'contents') return 0;
    const scrolls = /auto|scroll/.test(cs.overflowX + cs.overflowY);
    if (scrolls) return 0; // grips would scroll with the content: wrap it in a [data-resizable] box
    return /hidden|clip/.test(cs.overflowX + cs.overflowY) ? 2 : 1;
  });
  const live = liveRegion();
  // accessible names: distinct per box; repeats get an ordinal ("kairo code block 3")
  const labels = cand.map((el, i) => (ok[i] ? boxLabel(el) : ''));
  const seen = seenLabels.get(document) ?? new Map<string, number>();
  seenLabels.set(document, seen);
  const total = new Map<string, number>();
  labels.forEach((l) => { if (l) total.set(l, (total.get(l) ?? 0) + 1); });
  cand.forEach((el, i) => {
    if (!ok[i]) return;
    const l = labels[i];
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    const label = n > 1 || (total.get(l) ?? 0) > 1 ? `${l} ${n}` : l;
    if (ok[i] === 2) el.classList.add('rz-host--inset');
    const inLink = !!el.closest('a, button, summary, label');
    // a link/button box: grips sit fully OUTSIDE it (and only take the pointer
    // while it is hovered, see global.css) so no part of the link is dead
    if (inLink && ok[i] !== 2) {
      el.classList.add('rz-host--outside');
      const b = borders[i];
      if (b) {
        el.style.setProperty('--rz-bb', b[0]);
        el.style.setProperty('--rz-br', b[1]);
        el.style.setProperty('--rz-bl', b[2]);
      }
    }
    try { bindAuto(el, inLink, live, label); } catch { /* resizing is a bonus */ }
  });
}
