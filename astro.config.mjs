import fs from 'node:fs';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import remarkCallouts from './remark-callouts.mjs';
import rehypeSeoHeadings from './rehype-seo-headings.mjs';
import { BUILD_DATE, lastmodFor } from './src/lib/lastmod.mjs';
import codeHints from './shiki-code-hints.mjs';

// Runs after rehype-katex:
// - a display formula scrolls sideways inside its frame when it is wider than
//   the column (phones), so its scroller gets tabindex="0" (like Shiki's <pre>)
//   and a group role + name for keyboard and screen-reader users;
// - rehype-katex only warns on a formula it cannot parse and renders red error
//   text, so fail the build instead of shipping that.
function rehypeMathBlocks() {
  const has = (node, cls) => node.type === 'element' && [].concat(node.properties?.className ?? []).includes(cls);
  return (tree, file) => {
    const walk = node => {
      for (const child of node.children ?? []) {
        if (has(child, 'katex-error')) {
          throw new Error(`KaTeX could not parse a formula in ${file.path}: ${child.properties?.title ?? ''}`);
        }
        if (has(child, 'katex-display')) {
          const scroller = child.children.find(c => has(c, 'katex'));
          if (scroller) Object.assign(scroller.properties, { tabIndex: 0, role: 'group', ariaLabel: 'Formula' });
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

// Build into an --outDir on another volume (e.g. a /tmp preview dir while the
// repo lives on an external disk): Astro 6 stages prerender assets in
// ./.astro/.prerender and fs.rename()s them into outDir, which fails with
// EXDEV across devices. Fall back to copy + unlink for that one case only.
{
  const rename = fs.promises.rename;
  if (!rename.__kairoExdev) {
    const patched = async (from, to) => {
      try {
        return await rename(from, to);
      } catch (e) {
        if (e?.code !== 'EXDEV') throw e;
        await fs.promises.cp(from, to, { recursive: true, force: true });
        await fs.promises.rm(from, { recursive: true, force: true });
      }
    };
    patched.__kairoExdev = true;
    fs.promises.rename = patched;
  }
}

// Fetch Kairo TextMate grammar at build time
let kairoLang = null;
try {
  const res = await fetch(
    'https://raw.githubusercontent.com/kairolang/kairo-lsp/lsp-v1/public/syntaxes/kairo.tmLanguage.json'
  );
  if (res.ok) {
    kairoLang = await res.json();
    console.log('[kairo-web] Loaded Kairo syntax grammar');
  }
} catch (e) {
  console.warn('[kairo-web] Could not fetch Kairo grammar:', e.message);
}

export default defineConfig({
  site: 'https://www.kairolang.org',
  output: 'static',
  // GitHub Pages serves /docs/ as a directory and 301s /docs -> /docs/.
  // Every internal URL ends in "/" so links, canonicals and the sitemap all
  // agree and no crawl hits a redirect. (File routes like /search.json,
  // /llms.txt and /og/*.png are unaffected.)
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    mdx(),
    sitemap({
      filter: page => !/\/404\/?$/.test(new URL(page).pathname),
      serialize(item) {
        const p = new URL(item.url).pathname;
        item.lastmod = (lastmodFor(p) ?? BUILD_DATE).toISOString();
        if (p === '/') {
          item.priority = 1.0;
          item.changefreq = 'weekly';
        } else if (p === '/docs/') {
          // docs hub: lists every section and the recently updated pages
          item.priority = 0.9;
          item.changefreq = 'weekly';
        } else if (p.startsWith('/docs/library/')) {
          item.priority = 0.6;
          item.changefreq = 'monthly';
        } else if (p.startsWith('/docs/')) {
          item.priority = 0.8;
          item.changefreq = 'weekly';
        } else if (p === '/blog/') {
          item.priority = 0.7;
          item.changefreq = 'weekly';
        } else if (p.startsWith('/blog/')) {
          item.priority = 0.7;
          item.changefreq = 'monthly';
        } else {
          item.priority = 0.5;
          item.changefreq = 'monthly';
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [
      tailwindcss(),
      // Dev only: mirror GitHub Pages, which 301s /path -> /path/. Without this,
      // trailingSlash: 'always' makes the dev server show its own "did you mean
      // /path/?" page instead of the route (or our 404).
      {
        name: 'kairo-dev-trailing-slash',
        enforce: 'post',
        configureServer(server) {
          // Astro unshifts its own trailing-slash check in a post hook; ours is
          // a post hook of a later plugin, so unshifting here puts it first.
          return () => server.middlewares.stack.unshift({ route: '', handle: (req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') return next();
            const [path, query] = (req.url ?? '/').split('?');
            const last = path.slice(path.lastIndexOf('/') + 1);
            if (path.endsWith('/') || last.includes('.') || /^\/(@|_|node_modules\/|src\/)/.test(path)) return next();
            res.statusCode = 301;
            res.setHeader('Location', path + '/' + (query ? `?${query}` : ''));
            res.end();
          } });
        },
      },
    ],
    server: {
        allowedHosts: ["072c-107-5-102-209.ngrok-free.app"],
    },
  },
  markdown: {
    // keep text exactly as typed: no curly quotes, en/em dashes or ellipses
    smartypants: false,
    // Math ($$...$$, inline or display) is rendered to HTML + MathML at build
    // time by KaTeX; no client JS. Single "$" stays plain text so a stray "$5"
    // or "$PATH" in prose never turns into math. A page that uses math imports
    // src/styles/math.css itself, so no other page loads the KaTeX CSS/fonts.
    remarkPlugins: [remarkCallouts, [remarkMath, { singleDollarTextMath: false }]],
    rehypePlugins: [
      [rehypeKatex, {
        output: 'htmlAndMathml',
        strict: 'error',
        // \htmlClass only (for muted clause labels); no other trusted commands.
        trust: ctx => ctx.command === '\\htmlClass',
      }],
      rehypeMathBlocks,
      rehypeSeoHeadings,
    ],
    shikiConfig: {
      themes: {
        dark: 'github-dark',
        light: 'github-light',
      },
      langs: kairoLang ? [kairoLang] : [],
      defaultColor: false,
      transformers: [codeHints()],
    },
  },
});
