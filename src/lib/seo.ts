/**
 * Shared SEO conventions: page <title> format, description fitting, and the
 * per-page OG image path (images rendered by src/pages/og/[...slug].png.ts).
 */

export const SITE_URL = 'https://www.kairolang.org';
export const SITE_NAME = 'Kairo';
export const HOME_TITLE = 'Kairo: The Systems Programming Language Beyond C++';
export const DEFAULT_DESCRIPTION =
  'Kairo is an open-source systems programming language with native, bidirectional C++ interop: C++ performance with modern safety and ergonomics.';

export type PageType = 'home' | 'docs' | 'blog' | 'page';

/** Suffixes earlier layouts appended themselves; stripped so they never double up. */
const LEGACY_SUFFIX = /\s+[-·|—]\s+Kairo(?: (?:Docs|Blog|Programming Language))?$/;

/** A title without any " · Kairo ..." / " - Kairo ..." suffix. */
export function bareTitle(raw: string): string {
  return raw.replace(LEGACY_SUFFIX, '').trim();
}

/**
 * Title convention:
 *   home -> HOME_TITLE ("Kairo: The Systems Programming Language Beyond C++")
 *   docs -> "<Page> · Kairo Docs"   (single-concept language pages read "Ownership in Kairo")
 *   blog -> "<Post> · Kairo Blog"
 *   page -> "<Page> · Kairo Programming Language"
 */
export function formatTitle(raw: string, type: PageType, pathname = ''): string {
  if (type === 'home') return raw && /programming language/i.test(raw) ? raw : HOME_TITLE;
  let t = raw.replace(LEGACY_SUFFIX, '').trim();
  if (type === 'docs') {
    // "Ownership" alone is ambiguous in a SERP; "Ownership in Kairo" is not.
    if (/^\/docs\/language\//.test(pathname) && !/kairo/i.test(t) && t.split(/\s+/).length <= 3 && t.length <= 26) {
      t = `${t} in Kairo`;
    }
    return fit(t, ' · Kairo Docs');
  }
  if (type === 'blog') return fit(t, ' · Kairo Blog');
  return fit(t, ' · Kairo Programming Language');
}

/** Keep titles SERP-sized: a long page name gets the short " · Kairo" suffix. */
function fit(t: string, suffix: string): string {
  return (t + suffix).length <= 70 ? t + suffix : `${t} · Kairo`;
}

/**
 * Meta descriptions should be ~50-160 chars. Long ones are cut at a word
 * boundary; short/missing ones get page context appended so every page has
 * a real, unique summary.
 */
export function fitDescription(desc: string | undefined, title: string, type: PageType): string {
  let d = (desc ?? '').replace(/\s+/g, ' ').trim();
  if (/^put something here/i.test(d)) d = '';
  const bare = title.replace(LEGACY_SUFFIX, '').trim();
  if (d.length < 50) {
    const ctx =
      type === 'docs'
        ? `${bare}: reference documentation for the Kairo programming language.`
        : type === 'blog'
          ? `${bare}, from the Kairo programming language blog.`
          : `${bare}, from the Kairo programming language project.`;
    d = d ? `${d.replace(/[.\s]*$/, '.')} ${ctx}` : ctx;
    if (d.length < 50) d = `${d} ${DEFAULT_DESCRIPTION}`;
  }
  if (d.length > 160) {
    const cut = d.slice(0, 157);
    const sp = cut.lastIndexOf(' ');
    d = (sp > 100 ? cut.slice(0, sp) : cut).replace(/[\s,;:.—-]+$/, '') + '...';
  }
  return d;
}

/** Static (non-collection) pages that get their own OG card. */
export const OG_PAGES: Record<string, { title: string; kicker: string; subtitle?: string }> = {
  index: { title: 'The Language Beyond C++', kicker: '', subtitle: 'open-source systems programming language' },
  blog: { title: 'Kairo Blog', kicker: 'blog', subtitle: 'design notes, proposals and updates' },
  ksf: { title: 'Kairo Software Foundation', kicker: 'ksf', subtitle: 'the nonprofit behind Kairo' },
  contributors: { title: 'Contributors', kicker: 'contributors', subtitle: 'the people building Kairo' },
};

/** OG image key for a URL path: "/" -> "index", "/docs/language/x/" -> "docs/language/x". */
export function ogKey(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURI(p);
  } catch {
    /* keep raw */
  }
  return p.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'index';
}

/**
 * OG image URL path for a page. Docs and blog pages each have their own card;
 * the static pages above do too; everything else falls back to the home card.
 */
export function ogImageFor(pathname: string, type: PageType): string {
  const key = ogKey(pathname);
  const own = type === 'docs' || type === 'blog' || type === 'home' || key in OG_PAGES;
  return `/og/${own ? key : 'index'}.png`;
}

/** Absolute, trailing-slash URL for an internal path (files keep their extension). */
export function absUrl(p: string): string {
  if (/^https?:\/\//.test(p)) return p;
  const [path, rest = ''] = p.split(/(?=[?#])/);
  const last = path.split('/').pop() ?? '';
  const withSlash = path.endsWith('/') || /\.[a-z0-9]{1,5}$/i.test(last) ? path : path + '/';
  return SITE_URL + (withSlash.startsWith('/') ? withSlash : '/' + withSlash) + rest;
}
