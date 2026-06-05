#!/usr/bin/env node
/**
 * generate-language-reference.mjs
 *
 * Generates /public/language-reference.md a single, human-readable page
 * containing ONLY the language reference docs (src/content/docs/language/),
 * in LANGUAGE_ORDER, with a table of contents.
 *
 * Run before `astro build`:
 *   "build": "node generate-language-reference.mjs && astro build"
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

// ── Configuration ──────────────────────────────────────────────
const CONTENT_DIR = 'src/content/docs/language';
const OUTPUT_FILE = 'public/language-reference.md';
const SITE_URL    = 'https://www.kairolang.org';

// Logical reading order. Pages not listed go at the end, alphabetically.
const LANGUAGE_ORDER = [
  'primitives',
  'variables',
  'operators',
  'control-flow',
  'functions',
  'closures',
  'classes',
  'structures',
  'enums',
  'unions',
  'interfaces',
  'type-system',
  'casting',
  'requires',
  'where',
  'pointers',
  'ownership',
  'amt',
  'unsafe',
  'panic',
  'eval',
  'modules',
  'extends',
  'attributes',
  'macros',
  'concurrency',
  'c-c++',
];

// ── Helpers ────────────────────────────────────────────────────

async function walk(dir) {
  const entries = [];
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...await walk(fullPath));
    } else if (['.md', '.mdx'].includes(extname(item.name))) {
      entries.push(fullPath);
    }
  }
  return entries;
}

function stripFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

function extractTitle(raw, fallback) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match) {
    const titleMatch = match[1].match(/title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) return titleMatch[1];
  }
  return fallback
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function extractDescription(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match) {
    const d = match[1].match(/description:\s*["']?(.+?)["']?\s*$/m);
    if (d) return d[1];
  }
  return '';
}

function stripMdxComponents(content) {
  content = content.replace(/^import\s+.*$/gm, '');
  content = content.replace(/<([A-Z]\w+)[^>]*\/>/g, '');
  content = content.replace(/<([A-Z]\w+)[^>]*>([\s\S]*?)<\/\1>/g, '$2');
  content = content.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  return content.trim();
}

function slugFromPath(filePath) {
  return basename(filePath).replace(/\.(mdx?|md)$/, '');
}

// GitHub-style heading slug, for the TOC anchors.
function anchorSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // drop punctuation
    .trim()
    .replace(/\s+/g, '-');
}

// Demote in-page headings by one level so the per-page H1/H2 sit under the
// page's own ## section heading and don't collide with the document H1.
// Leaves fenced code blocks untouched.
function demoteHeadings(body) {
  const lines = body.split('\n');
  let inFence = false;
  let fenceMarker = '';
  return lines.map(line => {
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      if (!inFence) { inFence = true; fenceMarker = marker; }
      else if (marker === fenceMarker) { inFence = false; fenceMarker = ''; }
      return line;
    }
    if (inFence) return line;
    // ATX headings only at column 0
    const h = line.match(/^(#{1,5})\s+(.*)$/);
    if (h) return `#${h[1]} ${h[2]}`;
    return line;
  }).join('\n');
}

// ── Sort ───────────────────────────────────────────────────────

function sortLanguage(files) {
  return [...files].sort((a, b) => {
    const sa = slugFromPath(a);
    const sb = slugFromPath(b);
    const ia = LANGUAGE_ORDER.indexOf(sa);
    const ib = LANGUAGE_ORDER.indexOf(sb);
    if (ia === -1 && ib === -1) return sa.localeCompare(sb);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const files = await walk(CONTENT_DIR);
  if (files.length === 0) {
    console.error(`[lang-ref] No files found in ${CONTENT_DIR}`);
    process.exit(1);
  }

  const sorted = sortLanguage(files);
  console.log(`[lang-ref] Found ${sorted.length} language pages`);

  // First pass: read + extract metadata so we can build the TOC.
  const pages = [];
  for (const filePath of sorted) {
    const raw  = await readFile(filePath, 'utf-8');
    const slug = slugFromPath(filePath);
    const title = extractTitle(raw, slug);
    const description = extractDescription(raw);
    let body = stripFrontmatter(raw);
    body = stripMdxComponents(body);
    body = demoteHeadings(body);
    pages.push({ slug, title, description, body });
  }

  const parts = [];

  // Document header
  parts.push('# Kairo Language Reference');
  parts.push('');
  parts.push('> The complete Kairo language reference, assembled into one page.');
  parts.push('> Kairo is a statically typed, compiled systems language with native');
  parts.push('> bidirectional C++ interoperability.');
  parts.push('>');
  parts.push(`> Source: ${SITE_URL}/docs/  ·  Generated: ${new Date().toISOString().slice(0, 10)}`);
  parts.push('');

  // Table of contents
  parts.push('## Contents');
  parts.push('');
  for (const p of pages) {
    const anchor = anchorSlug(p.title);
    const desc = p.description ? ` ${p.description}` : '';
    parts.push(`- [${p.title}](#${anchor})${desc}`);
  }
  parts.push('');
  parts.push('---');
  parts.push('');

  // Body
  for (const p of pages) {
    parts.push(`## ${p.title}`);
    parts.push('');
    parts.push(`<sub>${SITE_URL}/docs/language/${p.slug}/</sub>`);
    parts.push('');
    parts.push(p.body);
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  const output = parts.join('\n');
  await writeFile(OUTPUT_FILE, output, 'utf-8');
  const sizeKB = (Buffer.byteLength(output) / 1024).toFixed(0);
  console.log(`[lang-ref] Wrote ${OUTPUT_FILE} (${sizeKB} KB, ${pages.length} pages)`);
}

main().catch(err => {
  console.error('[lang-ref] Fatal:', err);
  process.exit(1);
});