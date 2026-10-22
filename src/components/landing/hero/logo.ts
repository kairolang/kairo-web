/**
 * KAIRO // ASCII — hero logo entrance.
 *
 * The FIGlet KAIRO loads in as dim shade glyphs (░▒, chosen per cell from the
 * final glyph's ink density + a stable hash — never re-rolled). A rectangular
 * lens (full logo height, ~8 columns wide) sweeps across it once, left to
 * right: inside it the cells show dense shades (▓▒░) at full colour, behind it
 * the logo is final. Each cell changes at most twice and only gets brighter.
 * On fine pointers the same rect lens then follows the cursor over the logo.
 * See lib/ascii/lens.ts.
 *
 * Replaces the old random-noise decode (it re-rolled a ░▒▓ band at 24fps
 * across half of the full-bright logo: a flicker).
 *
 * Keeps the decodeLogo() contract Hero.astro relies on: it sets
 * [data-decoded] (Hero's CSS keeps the logo hidden until then) only after
 * the shaded first state is in place, and resolves once the logo is final.
 */
import { lensReveal } from '../../../lib/ascii/lens';

export function decodeLogo(root: HTMLElement, { duration = 850, delay = 0 } = {}): Promise<void> {
  const done = lensReveal(root, {
    duration: Math.min(1100, Math.max(800, duration)),
    delay: 40 + delay,
    whenVisible: false,
  });
  root.setAttribute('data-decoded', '');
  return done;
}
