// @ts-check
/**
 * Last-modified dates per site route, for the sitemap <lastmod> and the
 * TechArticle/BlogPosting dateModified in JSON-LD.
 *
 * Source of truth, in order:
 *   1. blog frontmatter `updatedDate` (an explicit editorial date wins)
 *   2. git: last commit touching the route's source file(s); a file with
 *      uncommitted changes uses its mtime (so local builds aren't stale)
 *   3. blog frontmatter `pubDate`
 *   4. build date
 * A docs hub page (frontmatter `template: hub`) lists the pages below it, so
 * it takes the newest date of its own file and every docs page in its folder.
 *
 * Note: CI must check out full history (actions/checkout `fetch-depth: 0`),
 * otherwise every file reports the HEAD commit date.
 *
 * Plain .mjs so astro.config.mjs can import it as well as .astro/.ts code.
 * Paths are resolved from process.cwd() (the project root during astro
 * dev/build); import.meta.url is not stable once Vite bundles this module.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const BUILD_DATE = new Date();

const ROOT = process.cwd();
const DOCS = 'src/content/docs';
const BLOG = 'src/content/blog';

/** Astro glob-loader style slug for one path segment. */
const slugSeg = (/** @type {string} */ s) =>
  s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

/** @param {string} dir @returns {string[]} repo-relative files */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

/** @returns {{ committed: Map<string, Date>, dirty: Set<string> }} */
function gitInfo() {
  const committed = new Map();
  const dirty = new Set();
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const prefix = path.relative(top, ROOT).split(path.sep).join('/');
    const strip = (/** @type {string} */ f) => (prefix && f.startsWith(prefix + '/') ? f.slice(prefix.length + 1) : f);
    const log = execFileSync(
      'git',
      ['-c', 'core.quotepath=off', 'log', '--format=@@%cI', '--name-only', '--no-renames', '--', 'src'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    let date = null;
    for (const line of log.split('\n')) {
      if (line.startsWith('@@')) date = new Date(line.slice(2));
      else if (line && date) {
        const f = strip(line);
        if (!committed.has(f)) committed.set(f, date); // log is newest-first
      }
    }
    const status = execFileSync('git', ['-c', 'core.quotepath=off', 'status', '--porcelain', '--', 'src'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    for (const line of status.split('\n')) {
      if (!line.trim()) continue;
      const f = line.slice(3).replace(/^"|"$/g, '');
      dirty.add(strip(f));
    }
  } catch {
    /* not a git checkout: fall through to frontmatter/build date */
  }
  return { committed, dirty };
}

/** @param {string} rel @param {ReturnType<typeof gitInfo>} git @returns {Date | undefined} */
function fileDate(rel, git) {
  const abs = path.join(ROOT, rel);
  const untracked = !git.committed.has(rel);
  if (git.dirty.has(rel) || [...git.dirty].some(d => d.endsWith('/') && rel.startsWith(d)) || (untracked && git.committed.size)) {
    try {
      return fs.statSync(abs).mtime;
    } catch {
      /* ignore */
    }
  }
  return git.committed.get(rel);
}

/** @param {string} rel */
function frontmatter(rel) {
  try {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const get = (/** @type {string} */ k) => {
      const v = m[1].match(new RegExp(`^${k}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm'))?.[1];
      const d = v ? new Date(v) : undefined;
      return d && !Number.isNaN(d.getTime()) ? d : undefined;
    };
    const template = m[1].match(/^template:\s*["']?(\w+)["']?\s*$/m)?.[1];
    return { pubDate: get('pubDate'), updatedDate: get('updatedDate'), template };
  } catch {
    return {};
  }
}

/** @param {(Date | undefined)[]} ds */
const latest = ds => {
  const ok = /** @type {Date[]} */ (ds.filter(Boolean));
  return ok.length ? new Date(Math.max(...ok.map(d => d.getTime()))) : undefined;
};

/** @type {Map<string, Date> | null} */
let cache = null;

/** Route path ("/docs/language/ownership/") → last-modified date. */
export function lastmodMap() {
  if (cache) return cache;
  const git = gitInfo();
  /** @type {Map<string, Date>} */
  const map = new Map();

  const docFiles = walk(DOCS).filter(f => /\.mdx?$/.test(f));
  /** @type {Array<{ route: string, dir: string, rel: string }>} */
  const hubs = [];
  for (const rel of docFiles) {
    const id = rel.slice(DOCS.length + 1).replace(/\.mdx?$/, '');
    const slug = id.split('/').map(slugSeg).join('/').replace(/(^|\/)index$/, '');
    const route = `/docs/${slug ? slug + '/' : ''}`;
    const d = fileDate(rel, git);
    if (d) map.set(route, d);
    if (frontmatter(rel).template === 'hub') hubs.push({ route, dir: path.posix.dirname(rel) + '/', rel });
  }
  for (const h of hubs) {
    const d = latest(docFiles.filter(f => f.startsWith(h.dir)).map(f => fileDate(f, git)));
    if (d) map.set(h.route, d);
  }

  /** @type {Date[]} */
  const blogDates = [];
  for (const rel of walk(BLOG).filter(f => /\.mdx?$/.test(f))) {
    const id = rel.slice(BLOG.length + 1).replace(/\.mdx?$/, '');
    const fm = frontmatter(rel);
    const d = fm.updatedDate ?? fileDate(rel, git) ?? fm.pubDate;
    if (d) {
      map.set(`/blog/${id.split('/').map(slugSeg).join('/')}/`, d);
      blogDates.push(d);
    }
  }

  const pageDate = (/** @type {string[]} */ ...rels) =>
    latest(rels.flatMap(r => (r.endsWith('/') ? walk(r.slice(0, -1)) : [r])).map(r => fileDate(r, git)));

  const home = pageDate('src/pages/index.astro', 'src/components/landing/');
  if (home) map.set('/', home);
  const blogIndex = latest([pageDate('src/pages/blog/index.astro'), ...blogDates]);
  if (blogIndex) map.set('/blog/', blogIndex);
  const ksf = pageDate('src/pages/ksf.astro');
  if (ksf) map.set('/ksf/', ksf);
  const contrib = pageDate('src/pages/contributors.astro', 'src/components/contributors/', 'src/lib/contributors.ts');
  if (contrib) map.set('/contributors/', contrib);

  cache = map;
  return map;
}

/** Last-modified date for a URL path (with or without trailing slash). */
export function lastmodFor(/** @type {string} */ pathname) {
  let p = pathname.startsWith('/') ? pathname : '/' + pathname;
  if (!p.endsWith('/')) p += '/';
  try {
    p = decodeURI(p);
  } catch {
    /* keep raw */
  }
  return lastmodMap().get(p.toLowerCase());
}
