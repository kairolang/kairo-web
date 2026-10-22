/**
 * Small helpers shared by the docs hub components (components/docs/hub/).
 * No site specifics: they work on rendered HTML strings and dates only.
 */

/** Two-digit ordinal for numbered blocks: 1 -> "01". */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** URL-safe id from free text: "Library & tools" -> "library-tools". */
export function slugId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Markdown list items written as "- [name](href) gloss text" render as
 * <li><a>name</a> gloss text</li>. Wrap the trailing plain text in
 * <span class="hub-gloss"> so it can be styled apart from the link.
 * Items with anything other than plain text after the link (nested lists,
 * inline code, more links) are left as they are.
 */
export function wrapGlosses(html: string): string {
  return html.replace(
    /(<li>\s*<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<\/a>)([^<]+)(?=<\/li>)/g,
    (all, link: string, text: string) => {
      const t = text.trim();
      return t ? `${link} <span class="hub-gloss">${t}</span>` : all;
    }
  );
}

/**
 * Width, in characters, of the widest link that starts a top-level list item
 * ("<li><a>kbld</a> ..."). Cards set it as --hub-name (in ch) so the glosses
 * after the links line up in one column, monospace-grid style. 0 when no
 * item has a gloss (nothing to align).
 */
export function linkColumn(html: string): number {
  if (!html.includes('hub-gloss')) return 0;
  let w = 0;
  for (const m of html.matchAll(/<li>\s*<a\b[^>]*>((?:(?!<\/a>)[\s\S])*)<\/a>/g)) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/&(?:#\d+|#x[0-9a-f]+|\w+);/gi, '_');
    w = Math.max(w, [...text.trim()].length);
  }
  return w;
}

/**
 * Room the frame's top-edge meta label ("< 9 pages >") takes, as an inline
 * style: the title notch on the same edge is cut to what is left
 * (hub.css: --hub-meta-w). Geist Mono: 0.6em advance + 0.1em tracking at
 * the meta's 0.62rem, plus its "< " " >" and padding.
 */
export function metaReserve(meta?: string): string | undefined {
  if (!meta) return undefined;
  return `--hub-meta-w: ${(([...meta].length + 5) * 0.7 * 0.62).toFixed(2)}rem`;
}

/** "today", "yesterday", "3d ago", "2w ago", "5mo ago", "1y ago" (relative to `now`). */
export function relativeAge(date: Date, now: Date): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Escape text for HTML, turning `code` spans (as written in frontmatter) into <code>. */
export function inlineCode(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/`([^`]+)`/g, '<code>$1</code>');
}
