import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildDocTree, docSourcePath, flattenPages } from '../lib/docs-tree';

export const GET: APIRoute = async ({ site }) => {
  const siteURL = (site ?? new URL('https://www.kairolang.org')).toString().replace(/\/$/, '');

  const docs = await getCollection('docs');
  const blog = await getCollection('blog');

  // Sidebar order (sections, language groups, parent -> child pages). Plain
  // `order` sorting no longer works: language pages number from 1 per group.
  const treeRank = new Map(flattenPages(buildDocTree(docs)).map((p, i) => [p.id, i]));
  const sortedDocs = [...docs].sort((a, b) => (treeRank.get(a.id) ?? Infinity) - (treeRank.get(b.id) ?? Infinity));

  const slugToUrl = (id: string) => {
    const clean = id.replace(/\.mdx?$/, '').replace(/\/index$/, '');
    return !clean || clean === 'index' ? `${siteURL}/docs/` : `${siteURL}/docs/${clean}/`;
  };

  const blogSlugToUrl = (id: string) => {
    return `${siteURL}/blog/${id.replace(/\.mdx?$/, '')}/`;
  };

  let content = `# Kairo - Complete Documentation\n`;
  content += `Source: ${siteURL}/llms-full.txt\n`;
  content += `Generated: ${new Date().toISOString()}\n\n`;
  content += `---\n\n`;

  // Full docs content
  content += `# Documentation\n\n`;
  // Hub pages (template: hub) are component layouts that only link to the
  // pages below them, which are all included in full.
  for (const doc of sortedDocs.filter(d => d.data.template !== 'hub')) {
    const url = slugToUrl(doc.id);
    content += `---\n`;
    content += `URL: ${url}\n`;
    content += `Title: ${doc.data.title}\n`;
    if (doc.data.description) content += `Description: ${doc.data.description}\n`;
    // source path, not id: folder index pages have ids without "/index"
    const parts = (docSourcePath(doc) ?? doc.id).replace(/\.mdx?$/, '').split('/');
    if (parts.length > 1) content += `Section: ${parts[0]}\n`;
    content += `\n`;
    content += doc.body;
    content += `\n\n`;
  }

  // Blog posts
  const publishedPosts = blog
    .filter(post => !post.data.draft)
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

  if (publishedPosts.length > 0) {
    content += `---\n\n`;
    content += `# Blog\n\n`;
    for (const post of publishedPosts) {
      const url = blogSlugToUrl(post.id);
      content += `---\n`;
      content += `URL: ${url}\n`;
      content += `Title: ${post.data.title}\n`;
      if (post.data.description) content += `Description: ${post.data.description}\n`;
      content += `Published: ${post.data.pubDate.toISOString().split('T')[0]}\n`;
      if (post.data.author) content += `Author: ${post.data.author}\n`;
      if (post.data.tags?.length) content += `Tags: ${post.data.tags.join(', ')}\n`;
      content += `\n`;
      content += post.body;
      content += `\n\n`;
    }
  }

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
