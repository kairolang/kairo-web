/**
 * KAIRO // ASCII - scroll "print" reveal.
 *
 * Elements are revealed top-to-bottom by a STEPPED clip-path (like lines
 * arriving on a terminal), never blurred or floated. The step count is
 * derived from the element's height (~1 step per 24px line, 3..12), and the
 * duration from the steps (160..300ms). Staggers cap at 6 children of delay so
 * a long list never takes more than ~0.5s to finish. Calm pages (docs/blog)
 * and reduced motion show everything immediately.
 *
 * Markup (CSS lives in global.css, guarded by html.js so no-JS shows all):
 *   <div data-reveal>...</div>                 print top -> bottom
 *   <div data-reveal="left">...</div>          print left -> right   ("right" = right -> left)
 *   <div data-reveal="none">...</div>          stepped opacity pop only ("scale" = same)
 *   <div data-reveal data-reveal-delay="120">  extra delay (ms)
 *   <ul data-reveal-stagger data-stagger-step="40">  children print in sequence (max 60)
 *
 *   import { initReveal, printIn } from '@/lib/ascii/reveal';
 *   initReveal();               // idempotent; BaseLayout calls it via initAscii()
 *   await printIn(el);          // reveal one element now (adds .revealed)
 */
import { stillPage } from './motion';

const SEL = '[data-reveal]:not(.revealed), [data-reveal-stagger]:not(.revealed)';
let io: IntersectionObserver | null = null;

function stepsFor(h: number): number {
  return Math.max(3, Math.min(12, Math.round(h / 24)));
}

function apply(el: HTMLElement, h: number, childHeights: number[] | null) {
  const extra = parseInt(el.dataset.revealDelay || '', 10) || 0;
  let total = 0;
  if (childHeights) {
    const step = Math.min(60, parseInt(el.dataset.staggerStep || '', 10) || 40);
    Array.prototype.forEach.call(el.children, (child: HTMLElement, i: number) => {
      const s = stepsFor(childHeights[i] ?? 48);
      const d = Math.max(140, Math.min(260, s * 24));
      const delay = extra + Math.min(i, 6) * step;
      child.style.setProperty('--reveal-steps', String(s));
      child.style.setProperty('--reveal-dur', d + 'ms');
      child.style.setProperty('--reveal-delay', delay + 'ms');
      total = Math.max(total, delay + d);
    });
  } else {
    const s = stepsFor(h);
    const d = Math.max(160, Math.min(300, s * 24));
    el.style.setProperty('--reveal-steps', String(s));
    el.style.setProperty('--reveal-dur', d + 'ms');
    el.style.setProperty('--reveal-delay', extra + 'ms');
    total = extra + d;
  }
  el.classList.add('revealed');
  // drop the clip once printed so overflow (notches, focus rings, menus) is never cut
  window.setTimeout(() => el.classList.add('reveal-done'), total + 60);
}

function handle(entries: IntersectionObserverEntry[]) {
  // batch reads, then writes (no layout thrash)
  const work: Array<[HTMLElement, number, number[] | null]> = [];
  for (const e of entries) {
    // A target whose top is already above the reveal line never "intersects"
    // (its clip keeps only a sliver at its TOP), e.g. after scroll restoration
    // or a #hash landing. IO's initial entry still reports it, so print it.
    const passed = e.isIntersecting || e.boundingClientRect.top < (e.rootBounds?.bottom ?? window.innerHeight);
    if (!passed) continue;
    const el = e.target as HTMLElement;
    io?.unobserve(el);
    const stagger = el.hasAttribute('data-reveal-stagger');
    work.push([
      el,
      e.boundingClientRect.height,
      stagger ? Array.prototype.map.call(el.children, (c: HTMLElement) => c.offsetHeight) as number[] : null,
    ]);
  }
  for (const [el, h, ch] of work) apply(el, h, ch);
}

export function initReveal(root: ParentNode = document): void {
  const els = root.querySelectorAll<HTMLElement>(SEL);
  if (stillPage() || typeof IntersectionObserver === 'undefined') {
    els.forEach((el) => el.classList.add('revealed', 'reveal-done'));
    return;
  }
  // threshold 0: a clipped target only exposes a 1px sliver (see global.css)
  io ??= new IntersectionObserver(handle, { threshold: 0, rootMargin: '0px 0px -32px 0px' });
  els.forEach((el) => io!.observe(el));
  bindCatchUp();
}

// Safety net: a fast jump past an element (End key, then scrolling back up)
// can skip it without ever intersecting. On scroll (rAF-throttled, passive),
// print any still-pending target whose top is above the viewport bottom.
let catchUpBound = false;
let catchUpRaf = 0;
function catchUp() {
  catchUpRaf = 0;
  const pending = document.querySelectorAll<HTMLElement>(SEL);
  if (!pending.length) return;
  const vh = window.innerHeight - 32; // same reveal line as the observer's rootMargin
  const late: HTMLElement[] = [];
  pending.forEach((el) => { if (el.getBoundingClientRect().top < vh) late.push(el); });
  if (!late.length) return;
  const sizes = late.map((el) => [
    el.getBoundingClientRect().height,
    el.hasAttribute('data-reveal-stagger') ? (Array.prototype.map.call(el.children, (c: HTMLElement) => c.offsetHeight) as number[]) : null,
  ] as const);
  late.forEach((el, i) => { io?.unobserve(el); apply(el, sizes[i][0], sizes[i][1]); });
}
function bindCatchUp() {
  if (catchUpBound) return;
  catchUpBound = true;
  window.addEventListener('scroll', () => { if (!catchUpRaf) catchUpRaf = requestAnimationFrame(catchUp); }, { passive: true });
}

/** Reveal one element immediately (resolves when the print finishes). */
export function printIn(el: HTMLElement): Promise<void> {
  if (stillPage()) { el.classList.add('revealed', 'reveal-done'); return Promise.resolve(); }
  io?.unobserve(el);
  const stagger = el.hasAttribute('data-reveal-stagger');
  const h = el.getBoundingClientRect().height;
  const ch = stagger ? (Array.prototype.map.call(el.children, (c: HTMLElement) => c.offsetHeight) as number[]) : null;
  apply(el, h, ch);
  return new Promise((r) => setTimeout(r, 320));
}
