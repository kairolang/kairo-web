/**
 * KAIRO // ASCII - global page chrome behaviours (wired by BaseLayout).
 *
 *  - initScrollProgress(): segmented red bar at the top of the viewport
 *    (#scroll-progress) + vim-style ruler text ("TOP" / "42%" / "BOT" / "ALL")
 *    in any [data-scroll-ruler] element (the header has one).
 *  - initCursorTrail(): tiny trailing glyphs behind the mouse. Only when
 *    <body data-trail> is present, the pointer is fine/hovering, and motion
 *    is allowed. 14 pooled spans, WAAPI transform/opacity only.
 *    RESTRAINT: OFF site-wide. BaseLayout neither sets data-trail nor calls
 *    this. Kept for API compatibility; do not re-enable.
 */
import { finePointer, pick, reducedMotion } from './motion';

let progressBound = false;
export function initScrollProgress(): void {
  if (progressBound) return;
  progressBound = true;
  const bar = document.getElementById('scroll-progress');
  let ticking = false;
  let lastQ = -1;
  let lastLabel = '';
  const update = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    // quantise to 12px segments so the bar advances block by block
    const w = window.innerWidth || 1;
    const segs = Math.max(1, Math.floor(w / 12));
    const q = Math.round(p * segs) / segs;
    if (bar && q !== lastQ) { lastQ = q; bar.style.setProperty('--p', String(q)); }
    const label = max <= 4 ? 'ALL' : p <= 0.005 ? 'TOP' : p >= 0.995 ? 'BOT' : String(Math.round(p * 100)).padStart(2, '0') + '%';
    if (label !== lastLabel) {
      lastLabel = label;
      document.querySelectorAll<HTMLElement>('[data-scroll-ruler]').forEach((el) => { el.textContent = label; });
    }
  };
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request, { passive: true });
  update();
}

let trailBound = false;
export function initCursorTrail(): void {
  if (trailBound || !document.body.hasAttribute('data-trail')) return;
  if (reducedMotion() || !finePointer() || typeof Element.prototype.animate !== 'function') return;
  trailBound = true;

  const layer = document.createElement('div');
  layer.className = 'cursor-trail';
  layer.setAttribute('aria-hidden', 'true');
  const POOL = 14;
  const spans: HTMLSpanElement[] = [];
  for (let i = 0; i < POOL; i++) {
    const s = document.createElement('span');
    layer.appendChild(s);
    spans.push(s);
  }
  document.body.appendChild(layer);

  const GL = '░▒▓█+*:.';
  let idx = 0, lx = -999, ly = -999, lt = 0;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || document.hidden) return;
    const now = e.timeStamp;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    if (now - lt < 24 || dx * dx + dy * dy < 324) return; // 18px, ~40/s max
    lx = e.clientX; ly = e.clientY; lt = now;
    const s = spans[idx = (idx + 1) % POOL];
    s.textContent = pick(GL);
    const x = Math.round(e.clientX + 8), y = Math.round(e.clientY + 10);
    s.animate(
      [
        { transform: `translate(${x}px, ${y}px)`, opacity: 0.85 },
        { transform: `translate(${x}px, ${y + 10}px)`, opacity: 0 },
      ],
      { duration: 340, easing: 'steps(4, end)', fill: 'forwards' },
    );
  }, { passive: true });
}
