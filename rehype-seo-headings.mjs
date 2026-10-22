/**
 * rehype-seo-headings.mjs
 *
 * Guarantees exactly one <h1> per rendered page (an SEO + a11y requirement):
 *
 *  - Blog posts: BlogLayout already renders the post title as the page <h1>.
 *    A content "# Heading" that just repeats the frontmatter title is dropped
 *    (it would print the title twice); any other content h1 becomes an h2.
 *  - Docs: DocsLayout renders no h1, the content's first "# Heading" is the
 *    page h1. Later h1s become h2s (they are section headings and now show
 *    up in the TOC). A doc with no h1 at all gets one from its frontmatter
 *    title.
 *
 * Other markdown (none today) is left untouched.
 */

/** @param {any} node @returns {string} */
function textOf(node) {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

const norm = s =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Collect every h1 element with its parent. */
function findH1s(node, parent = null, out = []) {
  if (node.type === 'element' && node.tagName === 'h1') out.push({ node, parent });
  for (const child of node.children ?? []) findH1s(child, node, out);
  return out;
}

export default function rehypeSeoHeadings() {
  return (tree, file) => {
    const fp = String(file.path ?? file.history?.[0] ?? '').split('\\').join('/');
    const kind = fp.includes('/src/content/blog/') ? 'blog' : fp.includes('/src/content/docs/') ? 'docs' : null;
    if (!kind) return;
    const title = file.data?.astro?.frontmatter?.title;
    const h1s = findH1s(tree);

    if (kind === 'blog') {
      for (const { node, parent } of h1s) {
        if (title && norm(textOf(node)) === norm(title) && parent) {
          parent.children.splice(parent.children.indexOf(node), 1);
        } else {
          node.tagName = 'h2';
        }
      }
      return;
    }

    // docs
    h1s.slice(1).forEach(({ node }) => (node.tagName = 'h2'));
    if (h1s.length === 0 && title) {
      tree.children.unshift({
        type: 'element',
        tagName: 'h1',
        properties: {},
        children: [{ type: 'text', value: String(title) }],
      });
    }
  };
}
