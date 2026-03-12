import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');
  const results = docs.map(doc => {
    const rawSlug = doc.slug.replace(/^docs\//, '').replace(/\/index$/, '');
    const url = !rawSlug || rawSlug === 'index' ? '/docs' : `/docs/${rawSlug}`;
    return {
      title: doc.data.title,
      description: doc.data.description ?? '',
      section: doc.data.section ?? 'Docs',
      url,
    };
  });
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
};
