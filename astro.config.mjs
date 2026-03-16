import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

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
  site: 'https://kairolang.org',
  output: 'static',
  integrations: [mdx(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    server: {
        allowedHosts: ["072c-107-5-102-209.ngrok-free.app"],
    },
  },
  markdown: {
    shikiConfig: {
      themes: {
        dark: 'github-dark',
        light: 'github-light',
      },
      langs: kairoLang ? [kairoLang] : [],
      defaultColor: false,
    },
  },
});
