import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { docHref, sectionFromId } from '../lib/docs-tree';

/** GitHub-style slug for heading anchors (mirrors Astro's slugger closely enough). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/** Strip MDX/Markdown syntax down to searchable plain text. */
function toPlainText(raw: string): string {
  return raw
    // imports / exports
    .replace(/^(import|export)\s.+$/gm, ' ')
    // code fence markers (keep the code itself — API names are searchable)
    .replace(/^```[^\n]*$/gm, ' ')
    // JSX/HTML tags
    .replace(/<[^>]+>/g, ' ')
    // markdown links/images -> keep label
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // headings markers, emphasis, inline code ticks
    .replace(/^#{1,6}\s+/gm, ' ')
    .replace(/[*_~`>|]/g, ' ')
    // callout syntax
    .replace(/\[!\w+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');

  const results = docs.map(doc => {
    const body = doc.body ?? '';

    // Extract headings (## .. ####) with anchors for deep links
    const headings: Array<{ text: string; slug: string }> = [];
    const headingRe = /^#{2,4}\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(body)) !== null) {
      const text = m[1].replace(/[*_`]/g, '').trim();
      if (text) headings.push({ text, slug: slugify(text) });
    }

    return {
      title: doc.data.title,
      description: doc.data.description ?? '',
      section: sectionFromId(doc.id),
      url: docHref(doc.id),
      headings,
      // Generous cap: full-text search needs the whole page; the cap only
      // bounds outliers like the single-file language reference.
      body: toPlainText(body).slice(0, 20000),
    };
  });

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
};
