#!/usr/bin/env node
/**
 * generate-llms-full.mjs
 *
 * Generates /public/llms-full.txt from the Astro content collection.
 * Run before `astro build` or add to your build script:
 *
 *   "build": "node generate-llms-full.mjs && astro build"
 *
 * Walks src/content/docs/ for .mdx/.md files, strips frontmatter,
 * and concatenates them in a logical order into one markdown file.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';

// ── Configuration ──────────────────────────────────────────────
const CONTENT_DIR  = 'src/content/docs';   // adjust if different
const BLOG_DIR     = 'src/content/blog';   // set to null to skip blog
const OUTPUT_FILE  = 'public/llms-full.txt';
const SITE_URL     = 'https://www.kairolang.org';

// Order for language reference pages. Pages not listed here go at the end.
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

// Top-level doc pages order
const TOP_ORDER = [
  'index',        // Welcome to Kairo
  'philosophy',
  'install',
  'compilence',
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
  if (match) {
    return content.slice(match[0].length).trim();
  }
  return content.trim();
}

function extractTitle(frontmatter, fallback) {
  const content = frontmatter || '';
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match) {
    const titleMatch = match[1].match(/title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) return titleMatch[1];
  }
  // Fallback: prettify the filename
  return fallback
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function stripMdxComponents(content) {
  // Remove import statements (import X from '...')
  content = content.replace(/^import\s+.*$/gm, '');
  // Remove JSX-style component tags like <Component ... /> or <Component>...</Component>
  // but keep their text content
  content = content.replace(/<([A-Z]\w+)[^>]*\/>/g, '');
  content = content.replace(/<([A-Z]\w+)[^>]*>([\s\S]*?)<\/\1>/g, '$2');
  // Remove {expressions} that are JSX
  content = content.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  return content.trim();
}

function slugFromPath(filePath, baseDir) {
  let rel = relative(baseDir, filePath);
  rel = rel.replace(/\.(mdx?|md)$/, '');
  if (rel.endsWith('/index')) rel = rel.slice(0, -6);
  if (rel === 'index') rel = '';
  return rel;
}

function fileUrl(slug, section) {
  if (section === 'docs') {
    return slug ? `${SITE_URL}/docs/${slug}/` : `${SITE_URL}/docs/`;
  }
  return `${SITE_URL}/blog/${slug}/`;
}

// ── Sort logic ─────────────────────────────────────────────────

function sortDocs(files, baseDir) {
  // Categorize files
  const topLevel = [];
  const language = [];
  const library = [];
  const toolchain = [];
  const examples = [];
  const other = [];

  for (const f of files) {
    const rel = relative(baseDir, f);
    if (rel.startsWith('language/'))       language.push(f);
    else if (rel.startsWith('library/'))   library.push(f);
    else if (rel.startsWith('toolchain/')) toolchain.push(f);
    else if (rel.startsWith('examples/'))  examples.push(f);
    else                                   topLevel.push(f);
  }

  // Sort top-level by defined order
  topLevel.sort((a, b) => {
    const sa = basename(a).replace(/\.(mdx?|md)$/, '');
    const sb = basename(b).replace(/\.(mdx?|md)$/, '');
    const ia = TOP_ORDER.indexOf(sa);
    const ib = TOP_ORDER.indexOf(sb);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  // Sort language by defined order
  language.sort((a, b) => {
    const sa = basename(a).replace(/\.(mdx?|md)$/, '');
    const sb = basename(b).replace(/\.(mdx?|md)$/, '');
    const ia = LANGUAGE_ORDER.indexOf(sa);
    const ib = LANGUAGE_ORDER.indexOf(sb);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  // Library and toolchain: alphabetical
  library.sort();
  toolchain.sort();
  examples.sort();
  other.sort();

  return [...topLevel, ...language, ...toolchain, ...examples, ...library, ...other];
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const parts = [];

  parts.push('# Kairo Full Documentation\n');
  parts.push('> Kairo is a statically typed, compiled systems programming language with native bidirectional C++ interoperability.\n');
  parts.push('> This file contains the complete language documentation concatenated for LLM consumption.\n');
  parts.push(`> Generated: ${new Date().toISOString()}\n`);
  parts.push('---\n');

  // ── Process docs ──
  const docFiles = await walk(CONTENT_DIR);
  if (docFiles.length === 0) {
    console.error(`[llms-full] No files found in ${CONTENT_DIR}`);
    process.exit(1);
  }

  const sorted = sortDocs(docFiles, CONTENT_DIR);
  console.log(`[llms-full] Found ${sorted.length} doc files`);

  let currentSection = '';

  for (const filePath of sorted) {
    const rel = relative(CONTENT_DIR, filePath);
    const section = rel.includes('/') ? rel.split('/')[0] : '_top';

    // Section headers
    if (section !== currentSection) {
      currentSection = section;
      const sectionName = section === '_top' ? 'Getting Started'
        : section.charAt(0).toUpperCase() + section.slice(1);
      parts.push(`\n${'='.repeat(72)}`);
      parts.push(`SECTION: ${sectionName.toUpperCase()}`);
      parts.push(`${'='.repeat(72)}\n`);
    }

    const raw = await readFile(filePath, 'utf-8');
    const title = extractTitle(raw, basename(filePath).replace(/\.(mdx?|md)$/, ''));
    const slug = slugFromPath(filePath, CONTENT_DIR);
    const url = fileUrl(slug, 'docs');
    let body = stripFrontmatter(raw);
    body = stripMdxComponents(body);

    parts.push(`## ${title}`);
    parts.push(`URL: ${url}`);
    parts.push('');
    parts.push(body);
    parts.push('\n---\n');
  }

  // ── Process blog (optional) ──
  if (BLOG_DIR) {
    const blogFiles = await walk(BLOG_DIR);
    if (blogFiles.length > 0) {
      blogFiles.sort(); // chronological by filename
      parts.push(`\n${'='.repeat(72)}`);
      parts.push('SECTION: BLOG');
      parts.push(`${'='.repeat(72)}\n`);

      for (const filePath of blogFiles) {
        const raw = await readFile(filePath, 'utf-8');
        const title = extractTitle(raw, basename(filePath).replace(/\.(mdx?|md)$/, ''));
        const slug = slugFromPath(filePath, BLOG_DIR);
        const url = fileUrl(slug, 'blog');
        let body = stripFrontmatter(raw);
        body = stripMdxComponents(body);

        parts.push(`## ${title}`);
        parts.push(`URL: ${url}`);
        parts.push('');
        parts.push(body);
        parts.push('\n---\n');
      }
      console.log(`[llms-full] Found ${blogFiles.length} blog files`);
    }
  }

  const output = parts.join('\n');
  await writeFile(OUTPUT_FILE, output, 'utf-8');
  const sizeMB = (Buffer.byteLength(output) / 1024 / 1024).toFixed(2);
  console.log(`[llms-full] Wrote ${OUTPUT_FILE} (${sizeMB} MB, ${sorted.length} docs)`);
}

main().catch(err => {
  console.error('[llms-full] Fatal:', err);
  process.exit(1);
});
