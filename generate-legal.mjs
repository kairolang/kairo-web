#!/usr/bin/env node
// Copies the Kairo repository's legal files into the site, so the site never
// carries its own copy of them. The repository is the source of truth:
//
//   LICENSE        -> public/LICENSE.txt          (raw text, served as-is)
//                  -> src/generated/LICENSE.txt   (rendered by src/pages/LICENSE.astro at /LICENSE)
//   TRADEMARKS.md  -> src/generated/TRADEMARKS.md (rendered as section 4 of /legal)
//
// /LICENSE is a page rather than a raw file because GitHub Pages serves an
// extensionless file as application/octet-stream (a download, not text).
// Never edit the generated copies by hand. KAIRO_REPO names a checkout of
// github.com/kairolang/kairo (CI checks out just these two files); when it is
// unset, a sibling checkout at ../kairo-lang is used.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const sibling = resolve(root, '..', 'kairo-lang');
const repo = process.env.KAIRO_REPO || (existsSync(join(sibling, 'LICENSE')) ? sibling : undefined);

function fail(msg) {
  console.error(`[generate-legal] ${msg}`);
  process.exit(1);
}

if (!repo) fail('KAIRO_REPO is not set and ../kairo-lang does not exist. Point KAIRO_REPO at a kairo repository checkout, e.g. KAIRO_REPO=/path/to/kairo.');

const license = join(resolve(repo), 'LICENSE');
const trademarks = join(resolve(repo), 'TRADEMARKS.md');
for (const f of [license, trademarks]) if (!existsSync(f)) fail(`${f} not found.`);

const generated = join(root, 'src', 'generated');
mkdirSync(generated, { recursive: true });

for (const target of [join(root, 'public', 'LICENSE.txt'), join(generated, 'LICENSE.txt')]) {
  copyFileSync(license, target);
  console.log(`[generate-legal] ${license} -> ${target}`);
}

// The page supplies its own section heading, so the policy's title goes and its
// sections move one level down. The words are unchanged.
const policy = readFileSync(trademarks, 'utf8')
  .replace(/^# .*\n+/, '')
  .replace(/^## /gm, '### ');
const policyTarget = join(generated, 'TRADEMARKS.md');
writeFileSync(policyTarget, policy);
console.log(`[generate-legal] ${trademarks} -> ${policyTarget}`);
