#!/usr/bin/env node
/**
 * generate-all.mjs - run every generate-*.mjs script in the repo root, one
 * after another, and report which ones failed.
 *
 *   node generate-all.mjs          (or: npm run generate)
 *
 * New generate-*.mjs scripts are picked up automatically. Exits non-zero if
 * any script fails; the rest still run.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const self = basename(fileURLToPath(import.meta.url));
const scripts = readdirSync(root)
  .filter(f => /^generate-.*\.mjs$/.test(f) && f !== self)
  .sort();

const failed = [];
for (const script of scripts) {
  console.log(`\n── ${script}`);
  const start = performance.now();
  const r = spawnSync(process.execPath, [join(root, script)], { cwd: root, stdio: 'inherit' });
  const secs = ((performance.now() - start) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`   ok (${secs}s)`);
  } else {
    console.log(`   FAILED (${r.error?.message ?? `exit ${r.status ?? r.signal}`}, ${secs}s)`);
    failed.push(script);
  }
}

console.log(`\n${scripts.length - failed.length}/${scripts.length} scripts succeeded`);
if (failed.length) {
  console.log(`failed: ${failed.join(', ')}`);
  process.exit(1);
}
