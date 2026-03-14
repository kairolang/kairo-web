import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async ({ site }) => {
  const siteURL = (site ?? new URL('https://kairolang.org')).toString().replace(/\/$/, '');

  const docs = await getCollection('docs');
  const blog = await getCollection('blog');

  const sortedDocs = docs.sort((a, b) => (a.data.order ?? 999) - (b.data.order ?? 999));

  const slugToUrl = (id: string) => {
    const clean = id.replace(/\.mdx?$/, '').replace(/\/index$/, '');
    return !clean || clean === 'index' ? `${siteURL}/docs` : `${siteURL}/docs/${clean}`;
  };

  const blogSlugToUrl = (id: string) => {
    return `${siteURL}/blog/${id.replace(/\.mdx?$/, '')}`;
  };

  let content = `# Kairo — Complete Documentation\n`;
  content += `Source: ${siteURL}/llms-full.txt\n`;
  content += `Generated: ${new Date().toISOString()}\n\n`;
  content += `---\n\n`;

  // Full docs content
  content += `# Documentation\n\n`;
  for (const doc of sortedDocs) {
    const url = slugToUrl(doc.id);
    content += `---\n`;
    content += `URL: ${url}\n`;
    content += `Title: ${doc.data.title}\n`;
    if (doc.data.description) content += `Description: ${doc.data.description}\n`;
    if (doc.data.section) content += `Section: ${doc.data.section}\n`;
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
