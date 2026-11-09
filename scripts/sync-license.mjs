#!/usr/bin/env node
// Copies the Kairo repository's LICENSE into public/LICENSE.txt so the site
// serves a byte-identical copy at /LICENSE.txt. Never edit public/LICENSE.txt
// by hand. Requires KAIRO_REPO to point at a checkout of github.com/kairolang/kairo.
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = process.env.KAIRO_REPO;

function fail(msg) {
  console.error(`[sync-license] ${msg}`);
  process.exit(1);
}

if (!repo) fail('KAIRO_REPO is not set. Point it at a kairo repository checkout, e.g. KAIRO_REPO=/path/to/kairo.');

// The kairo repo ships its license as LICENSE.txt; accept plain LICENSE too.
const candidates = ['LICENSE.txt', 'LICENSE'].map(name => join(resolve(repo), name));
const source = candidates.find(existsSync);
if (!source) fail(`no LICENSE.txt or LICENSE found in ${resolve(repo)}.`);

const target = join(root, 'public', 'LICENSE.txt');
copyFileSync(source, target);
console.log(`[sync-license] ${source} -> ${target}`);
