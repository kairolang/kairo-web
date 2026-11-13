#!/usr/bin/env node
/**
 * generate-contributors.mjs - refresh src/data/contributors.json, the snapshot
 * the site falls back to when GitHub can't be reached at build time.
 *
 *   node generate-contributors.mjs     (also run by: npm run generate)
 *
 * GITHUB_TOKEN raises the rate limit. On any failure the old snapshot is kept
 * and the script exits non-zero.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLive } from './src/lib/contributors-fetch.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'src', 'data', 'contributors.json');
try {
  const data = await fetchLive(30000);
  await writeFile(out, JSON.stringify(data, null, 2) + '\n');
  console.log(`[generate-contributors] ${data.contributors.length} contributors across ${data.repos.length} repos -> src/data/contributors.json`);
} catch (err) {
  console.error(`[generate-contributors] ${err?.message ?? err}; snapshot left unchanged`);
  process.exit(1);
}
