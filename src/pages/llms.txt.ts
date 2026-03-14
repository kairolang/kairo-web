import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async ({ site }) => {
  const siteURL = (site ?? new URL('https://kairolang.org')).toString().replace(/\/$/, '');

  const docs = await getCollection('docs');
  const blog = await getCollection('blog');

  // Sort docs by order
  const sortedDocs = docs.sort((a, b) => (a.data.order ?? 999) - (b.data.order ?? 999));

  // Group docs by section
  const sections = new Map<string, typeof sortedDocs>();
  for (const doc of sortedDocs) {
    const section = doc.data.section ?? 'Documentation';
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(doc);
  }

  const slugToUrl = (id: string) => {
    const clean = id.replace(/\.mdx?$/, '').replace(/\/index$/, '');
    return !clean || clean === 'index' ? `${siteURL}/docs` : `${siteURL}/docs/${clean}`;
  };

  const blogSlugToUrl = (id: string) => {
    return `${siteURL}/blog/${id.replace(/\.mdx?$/, '')}`;
  };

  let content = `# Kairo\n\n`;
  content += `> Kairo is a modern, compiled systems programming language designed for control, performance, and clarity. Built by the Kairo Software Foundation, it targets the same problem space as Rust and Zig — with a distinct philosophy: you should be able to do anything the hardware supports, without the language standing in your way. Zero-cost abstractions, manual or assisted memory control, first-class C/C++ interop, and modern ergonomics (generics, interfaces, pattern matching, lambdas) — all compiled to optimal machine code.\n\n`;

  // Docs sections
  for (const [section, entries] of sections) {
    content += `## ${section}\n\n`;
    for (const doc of entries) {
      const url = slugToUrl(doc.id);
      const desc = doc.data.description ? `: ${doc.data.description}` : '';
      content += `- [${doc.data.title}](${url})${desc}\n`;
    }
    content += '\n';
  }

  // Blog posts (exclude drafts)
  const publishedPosts = blog
    .filter(post => !post.data.draft)
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

  if (publishedPosts.length > 0) {
    content += `## Blog\n\n`;
    for (const post of publishedPosts) {
      const url = blogSlugToUrl(post.id);
      const desc = post.data.description ? `: ${post.data.description}` : '';
      content += `- [${post.data.title}](${url})${desc}\n`;
    }
    content += '\n';
  }

  content += `## Optional\n\n`;
  content += `- [Full Documentation](${siteURL}/llms-full.txt): Complete Kairo documentation in a single plaintext file for AI consumption\n`;
  content += `- [Kairo Software Foundation](${siteURL}/ksf): The nonprofit governing body behind Kairo\n`;
  content += `- [Search API](${siteURL}/search.json): Structured JSON index of all documentation pages\n`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
