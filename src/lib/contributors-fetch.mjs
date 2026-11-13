/**
 * Live contributor fetch from the GitHub API. Plain JS so that both the site
 * build (src/lib/contributors.ts) and generate-contributors.mjs run it.
 *
 * Every public, non-fork repo in the org; contributors aggregated per login,
 * bots excluded. Uses process.env.GITHUB_TOKEN when set (60 to 5000 req/h).
 */
export const ORG = 'kairolang';

const API = 'https://api.github.com';
const TOTAL_TIMEOUT_MS = 8000;
const REQ_TIMEOUT_MS = 4000;

function headers() {
  /** @type {Record<string, string>} */
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kairo-web-build',
  };
  const token = typeof process !== 'undefined' ? process.env.GITHUB_TOKEN : undefined;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function getJSON(url, deadline) {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error('contributors: deadline exceeded');
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(Math.min(REQ_TIMEOUT_MS, left)) });
  if (res.status === 204) return null; // empty repo
  if (!res.ok) throw new Error(`contributors: ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** Follows ?page= until a short page; capped so a huge repo can't stall the build. */
async function getAll(base, deadline, maxPages = 5) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = base.includes('?') ? '&' : '?';
    const chunk = await getJSON(`${base}${sep}per_page=100&page=${page}`, deadline);
    if (!chunk || !Array.isArray(chunk)) break;
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

const isBot = (c) => c.type === 'Bot' || /\[bot\]$/i.test(c.login ?? '');

/**
 * Hits the GitHub API now. Throws on any failure (callers fall back).
 * @param {number} [timeoutMs]
 */
export async function fetchLive(timeoutMs = TOTAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  const repos = (await getAll(`${API}/orgs/${ORG}/repos?type=public&sort=full_name`, deadline, 3))
    .filter((r) => !r.fork && !r.private)
    .map((r) => r.name);
  if (!repos.length) throw new Error('contributors: no repos returned');

  const byLogin = new Map();
  const lists = await Promise.all(
    repos.map(async (repo) => ({ repo, list: await getAll(`${API}/repos/${ORG}/${repo}/contributors`, deadline) })),
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
