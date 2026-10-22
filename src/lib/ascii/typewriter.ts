/**
 * KAIRO // ASCII — typewriter with a blinking block cursor.
 *
 *   import { typewrite, bindTypewriters } from '@/lib/ascii/typewriter';
 *   await typewrite(el, { text: '$ kairo --version', cps: 70 });
 *
 * Markup auto-binding (wired globally by initAscii()):
 *   <span data-typewriter>$ kairo build main.k</span>   types when first visible
 *   data-typewriter-cps="80"     chars / second (default 60)
 *   data-typewriter-delay="200"  ms before starting
 *   data-typewriter-cursor="keep"  leave a █ cursor afterwards (blinks 3x, then
 *                                  stays solid; add class .blink-forever to the
 *                                  element's cursor only in the hero)
 *   data-typewriter-repeat       replay on every view (default: plays once per
 *                                tab session per page+text, then shows final)
 *
 * RESTRAINT: short lines only (install command, boot log) — never paragraphs.
 * Calm pages (docs/blog) and reduced motion: final text immediately.
 *
 * Layout never shifts: the untyped remainder is rendered transparent, so the
 * element is full size from frame 0. Plain-text elements only (children are
 * flattened to textContent). Reduced motion: final text immediately.
 */
import { onceVisible, reducedMotion, seenThisSession, stillPage } from './motion';

export interface TypewriteOptions {
  text?: string;
  /** characters per second. Default 60 */
  cps?: number;
  delay?: number;
  /** keep a blinking cursor after typing completes. Default false */
  keepCursor?: boolean;
}

const running = new WeakMap<Element, number>();
let seq = 0;

export function typewrite(el: HTMLElement, opts: TypewriteOptions = {}): Promise<void> {
  const full = opts.text ?? el.dataset.typewriterText ?? el.textContent ?? '';
  el.dataset.typewriterText = full;
  const { cps = 60, delay = 0, keepCursor = false } = opts;
  const done = () => {
    el.textContent = full;
    if (keepCursor) {
      const c = document.createElement('span');
      c.className = 'blink-cursor-glyph';
      c.setAttribute('aria-hidden', 'true');
      c.textContent = '█';
      el.append(c);
    }
    el.setAttribute('data-typed', '');
  };
  if (reducedMotion()) { done(); return Promise.resolve(); }

  const token = ++seq;
  running.set(el, token);
  el.textContent = '';
  const typed = document.createElement('span');
  const cursor = document.createElement('span');
  const rest = document.createElement('span');
  cursor.className = 'tw-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.textContent = '█';
  rest.className = 'tw-rest';
  rest.setAttribute('aria-hidden', 'true');
  rest.textContent = full;
  el.append(typed, cursor, rest);
  el.setAttribute('data-typed', '');

  const chars = [...full];
  return new Promise((resolve) => {
    const t0 = performance.now() + delay;
    let shown = -1;
    const frame = (now: number) => {
      if (running.get(el) !== token) { resolve(); return; }
      const n = Math.max(0, Math.min(chars.length, Math.floor(((now - t0) / 1000) * cps)));
      if (n !== shown) {
        shown = n;
        typed.textContent = chars.slice(0, n).join('');
        rest.textContent = chars.slice(n).join('');
      }
      if (n >= chars.length) { running.delete(el); done(); resolve(); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Show the final state at once (no typing), matching typewrite()'s end state. */
function finishNow(el: HTMLElement, keepCursor: boolean): void {
  const full = el.dataset.typewriterText ?? el.textContent ?? '';
  el.dataset.typewriterText = full;
  el.textContent = full;
  if (keepCursor) {
    const c = document.createElement('span');
    c.className = 'blink-cursor-glyph';
    c.setAttribute('aria-hidden', 'true');
    c.textContent = '█';
    el.append(c);
  }
  el.setAttribute('data-typed', '');
}

export function bindTypewriters(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-typewriter]:not([data-typewriter-bound])').forEach((el) => {
    el.setAttribute('data-typewriter-bound', '');
    const cps = parseFloat(el.dataset.typewriterCps || '') || 60;
    const delay = parseInt(el.dataset.typewriterDelay || '', 10) || 0;
    const keepCursor = el.dataset.typewriterCursor === 'keep';
    const key = 'tw:' + location.pathname + ':' + (el.textContent ?? '').trim().slice(0, 80);
    const repeat = el.hasAttribute('data-typewriter-repeat');
    if (stillPage() || (!repeat && seenThisSession(key, false))) { finishNow(el, keepCursor); return; }
    onceVisible(el, () => { if (!repeat) seenThisSession(key); void typewrite(el, { cps, delay, keepCursor }); });
  });
}
