/**
 * Contributors data + ASCII avatars (BUILD TIME ONLY: Node, uses sharp).
 *
 *   const data = await getContributors();          // live GitHub fetch, snapshot fallback
 *   const art  = await avatarAscii(c);              // { dark, light, source } HTML strings
 *
 * Live fetch: every public, non-fork repo in the kairolang org, contributors
 * aggregated per login, bots excluded. Uses process.env.GITHUB_TOKEN when set.
 * Any error / timeout / rate limit falls back to src/data/contributors.json (the snapshot).
 * Builds never fail because of GitHub.
 *
 * Env:
 *   GITHUB_TOKEN               optional, raises the rate limit (60 to 5000/h)
 *   KAIRO_CONTRIBUTORS_OFFLINE=1  skip the network entirely (snapshot + cached / identicon avatars)
 *
 * Refresh the snapshot:
 *   bun -e "import { fetchLive } from './src/lib/contributors.ts'; \
 *     await Bun.write('src/data/contributors.json', JSON.stringify(await fetchLive(), null, 2) + '\n')"
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import snapshot from '../data/contributors.json';

export const ORG = 'kairolang';

export interface RepoShare {
  name: string;
  contributions: number;
}

export interface Contributor {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
  repos: RepoShare[];
}

export interface ContributorsData {
  org: string;
  generated_at: string;
  /** repos that were scanned (public, non-fork), by name */
  repos: string[];
  contributors: Contributor[];
  /** 'live' when fetched during this build, 'snapshot' when read from src/data */
  source?: 'live' | 'snapshot';
}

const API = 'https://api.github.com';
const TOTAL_TIMEOUT_MS = 8000;
const REQ_TIMEOUT_MS = 4000;

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kairo-web-build',
  };
  const token = typeof process !== 'undefined' ? process.env.GITHUB_TOKEN : undefined;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function getJSON<T>(url: string, deadline: number): Promise<T | null> {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error('contributors: deadline exceeded');
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(Math.min(REQ_TIMEOUT_MS, left)) });
  if (res.status === 204) return null; // empty repo
  if (!res.ok) throw new Error(`contributors: ${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

/** Follows ?page= until a short page; capped so a huge repo can't stall the build. */
async function getAll<T>(base: string, deadline: number, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = base.includes('?') ? '&' : '?';
    const chunk = await getJSON<T[]>(`${base}${sep}per_page=100&page=${page}`, deadline);
    if (!chunk || !Array.isArray(chunk)) break;
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

interface GhRepo { name: string; fork: boolean; private: boolean; }
interface GhContributor { login?: string; type?: string; avatar_url?: string; html_url?: string; contributions: number; }

const isBot = (c: GhContributor) => c.type === 'Bot' || /\[bot\]$/i.test(c.login ?? '');

/** Hits the GitHub API now. Throws on any failure (callers fall back). */
export async function fetchLive(timeoutMs = TOTAL_TIMEOUT_MS): Promise<ContributorsData> {
  const deadline = Date.now() + timeoutMs;
  const repos = (await getAll<GhRepo>(`${API}/orgs/${ORG}/repos?type=public&sort=full_name`, deadline, 3))
    .filter((r) => !r.fork && !r.private)
    .map((r) => r.name);
  if (!repos.length) throw new Error('contributors: no repos returned');

  const byLogin = new Map<string, Contributor>();
  const lists = await Promise.all(
    repos.map(async (repo) => ({ repo, list: await getAll<GhContributor>(`${API}/repos/${ORG}/${repo}/contributors`, deadline) })),
  );
  for (const { repo, list } of lists) {
    for (const c of list) {
      if (!c.login || isBot(c) || !c.contributions) continue;
      const key = c.login.toLowerCase();
      let agg = byLogin.get(key);
      if (!agg) {
        agg = {
          login: c.login,
          avatar_url: c.avatar_url ?? `https://avatars.githubusercontent.com/${c.login}`,
          html_url: c.html_url ?? `https://github.com/${c.login}`,
          contributions: 0,
          repos: [],
        };
        byLogin.set(key, agg);
      }
      agg.contributions += c.contributions;
      agg.repos.push({ name: repo, contributions: c.contributions });
    }
  }
  const contributors = [...byLogin.values()]
    .map((c) => ({ ...c, repos: c.repos.sort((a, b) => b.contributions - a.contributions) }))
    .sort((a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login));
  if (!contributors.length) throw new Error('contributors: empty result');

  return { org: ORG, generated_at: new Date().toISOString(), repos, contributors };
}

let memo: Promise<ContributorsData> | undefined;

/** Live data if GitHub answers quickly, else the committed snapshot. Memoized per process. */
export function getContributors(): Promise<ContributorsData> {
  if (memo) return memo;
  const fallback = (): ContributorsData => ({ ...(snapshot as ContributorsData), source: 'snapshot' });
  if (process.env.KAIRO_CONTRIBUTORS_OFFLINE === '1') return (memo = Promise.resolve(fallback()));
  memo = fetchLive()
    .then((d): ContributorsData => ({ ...d, source: 'live' }))
    .catch((err) => {
      console.warn(`[contributors] live fetch failed, using snapshot: ${err?.message ?? err}`);
      return fallback();
    });
  return memo;
}

/* ─── ASCII avatars ──────────────────────────────────────────────────── */

/** Cells: Geist Mono is 0.6em × 1.3em per cell (aspect ≈ 2.17), so 24×11 is ~square. */
export const AVATAR_COLS = 24;
export const AVATAR_ROWS = 11;
const RAMP = ' .:-=+*#%@';
const CACHE_DIR = join(process.cwd(), 'node_modules', '.cache', 'kairo-avatars');
const CACHE_VERSION = 'v1';

export interface AvatarArt {
  /** HTML (escaped glyphs; dim runs wrapped in <span class="d">) for the dark theme: bright pixel = dense glyph */
  dark: string;
  /** same, inverted luminance for the light theme: dark pixel = dense glyph */
  light: string;
  source: 'avatar' | 'identicon';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Luminance grid (0..1, rows × cols) -> toned HTML. Low-density glyphs render dim. */
function gridToHtml(lum: number[], invert: boolean): string {
  const lines: string[] = [];
  const last = RAMP.length - 1;
  for (let y = 0; y < AVATAR_ROWS; y++) {
    let line = '';
    let run = '';
    let runDim: boolean | null = null;
    const flush = () => {
      if (!run) return;
      line += runDim ? `<span class="d">${esc(run)}</span>` : esc(run);
      run = '';
    };
    for (let x = 0; x < AVATAR_COLS; x++) {
      let v = lum[y * AVATAR_COLS + x];
      if (invert) v = 1 - v;
      const i = Math.max(0, Math.min(last, Math.round(v * last)));
      const ch = RAMP[i];
      const dim = i < 5;
      if (ch !== ' ' && dim !== runDim) { flush(); runDim = dim; }
      run += ch;
    }
    flush();
    lines.push(line); // keep trailing spaces: fixed-width block
  }
  return lines.join('\n');
}

/** Contrast-stretch so faint/flat avatars still read. */
function normalize(px: ArrayLike<number>): number[] {
  let lo = 255, hi = 0;
  for (let i = 0; i < px.length; i++) { if (px[i] < lo) lo = px[i]; if (px[i] > hi) hi = px[i]; }
  const span = Math.max(24, hi - lo);
  return Array.from(px, (p) => Math.max(0, Math.min(1, (p - lo) / span)));
}

/** Deterministic GitHub-style 5×5 mirrored identicon, upscaled into the cell grid. */
function identiconGrid(login: string): number[] {
  const h = createHash('sha1').update(login.toLowerCase()).digest();
  const cells: number[] = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) cells.push(h[r * 3 + c] & 1 ? 1 : 0);
  const at = (r: number, c: number) => cells[r * 3 + (c < 3 ? c : 4 - c)];
  const lum: number[] = [];
  for (let y = 0; y < AVATAR_ROWS; y++) {
    for (let x = 0; x < AVATAR_COLS; x++) {
      // 1-cell margin each side; map remaining area onto the 5×5 grid
      const gx = Math.floor(((x - 2) / (AVATAR_COLS - 4)) * 5);
      const gy = Math.floor(((y - 1) / (AVATAR_ROWS - 2)) * 5);
      const inside = gx >= 0 && gx < 5 && gy >= 0 && gy < 5;
      lum.push(inside ? (at(gy, gx) ? 0.95 : 0.12) : 0);
    }
  }
  return lum;
}

function avatarUrl(base: string, size: number): string {
  const u = new URL(base);
  u.searchParams.set('s', String(size));
  return u.toString();
}

/** Small photo URL for the hover reveal. */
export const avatarPhoto = (c: Pick<Contributor, 'avatar_url'>, size = 160) => avatarUrl(c.avatar_url, size);

async function convert(c: Pick<Contributor, 'login' | 'avatar_url'>): Promise<AvatarArt> {
  if (process.env.KAIRO_CONTRIBUTORS_OFFLINE !== '1') {
    try {
      const res = await fetch(avatarUrl(c.avatar_url, 64), {
        headers: { 'User-Agent': 'kairo-web-build' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const sharp = (await import('sharp')).default;
      const { data } = await sharp(buf)
        .flatten({ background: '#000000' })
        .resize(AVATAR_COLS, AVATAR_ROWS, { fit: 'fill', kernel: 'lanczos3' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const lum = normalize(data);
      return { dark: gridToHtml(lum, false), light: gridToHtml(lum, true), source: 'avatar' };
    } catch (err: any) {
      console.warn(`[contributors] avatar for @${c.login} failed (${err?.message ?? err}); using identicon`);
    }
  }
  const lum = identiconGrid(c.login);
  return { dark: gridToHtml(lum, false), light: gridToHtml(lum, false), source: 'identicon' };
}

const inflight = new Map<string, Promise<AvatarArt>>();

/** ASCII art for one contributor, cached on disk by avatar URL (identicons are not cached, so a later build retries). */
export function avatarAscii(c: Pick<Contributor, 'login' | 'avatar_url'>): Promise<AvatarArt> {
  const key = createHash('sha1').update(`${CACHE_VERSION}|${AVATAR_COLS}x${AVATAR_ROWS}|${c.avatar_url}`).digest('hex');
  const hit = inflight.get(key);
  if (hit) return hit;
  const file = join(CACHE_DIR, `${key}.json`);
  const p = (async () => {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as AvatarArt;
    } catch {}
    const art = await convert(c);
    if (art.source === 'avatar') {
      try {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, JSON.stringify(art));
      } catch {}
    }
    return art;
  })();
  inflight.set(key, p);
  return p;
}

/** Fixed-width ASCII bar: "████████████░░░░" */
export function bar(value: number, max: number, cells: number): string {
  const n = max > 0 ? Math.max(value > 0 ? 1 : 0, Math.round((value / max) * cells)) : 0;
  return '█'.repeat(n) + '░'.repeat(cells - n);
}
