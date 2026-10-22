/**
 * /og/<page>.png: 1200x630 ASCII-styled social cards, one per docs page,
 * blog post and top-level page, rendered at build time (see lib/og-image.ts).
 * BaseLayout/Seo pick the matching card via ogImageFor() in lib/seo.ts.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { docHref } from '../../lib/docs-tree';
import { renderOgPng, type OgCard } from '../../lib/og-image';
import { OG_PAGES, ogKey } from '../../lib/seo';

/** Prompt path for the card; long library paths keep their tail. */
function kickerFor(key: string): string {
  const dir = key.split('/').slice(0, -1);
  if (!dir.length) return key;
  const k = dir.join('/');
  return k.length <= 44 ? k : `docs/.../${dir.slice(-2).join('/')}`;
}

export const getStaticPaths = (async () => {
  const docs = await getCollection('docs');
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  const paths: Array<{ params: { slug: string }; props: OgCard }> = [];

  for (const [slug, card] of Object.entries(OG_PAGES)) paths.push({ params: { slug }, props: card });
  for (const doc of docs) {
    const key = ogKey(docHref(doc.id));
    paths.push({ params: { slug: key }, props: { title: doc.data.title, kicker: kickerFor(key) } });
  }
  for (const post of posts) {
    const key = `blog/${post.id.replace(/\.mdx?$/, '')}`;
    paths.push({ params: { slug: key }, props: { title: post.data.title, kicker: 'blog' } });
  }
  return paths;
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgPng(props as OgCard);
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
