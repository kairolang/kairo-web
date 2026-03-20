import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { docHref, sectionFromId } from '../lib/docs-tree';

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');
  const results = docs.map(doc => ({
    title: doc.data.title,
    description: doc.data.description ?? '',
    section: sectionFromId(doc.id),
    url: docHref(doc.id),
  }));
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
};
