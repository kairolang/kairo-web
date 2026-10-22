/**
 * KAIRO // ASCII - barrel + global initialiser.
 *
 * BaseLayout runs initAscii() on every page (and on astro:page-load), so any
 * markup using the data-attributes below "just works" without page scripts:
 *   [data-reveal] [data-reveal-stagger]       -> reveal.ts
 *   [data-scramble] [data-scramble-hover]     -> scramble.ts
 *   [data-typewriter]                         -> typewriter.ts
 *   [data-count-to] [data-ascii-bar]          -> counter.ts
 *   [data-ascii-field]                        -> field.ts
 */
import { bindCounters } from './counter';
import { bindFields } from './field';
import { initReveal } from './reveal';
import { bindScramble } from './scramble';
import { bindTypewriters } from './typewriter';

export * from './motion';
export * from './scramble';
export * from './typewriter';
export * from './counter';
export * from './reveal';
export * from './field';
export * from './figlet';
export * from './resize';
export * from './lens';

declare global {
  interface Window { __asciiReady?: boolean }
}

export function initAscii(root: ParentNode = document): void {
  window.__asciiReady = true;
  initReveal(root);
  bindScramble(root);
  bindTypewriters(root);
  bindCounters(root);
  bindFields(root);
}
