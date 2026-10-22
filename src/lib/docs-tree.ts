export interface DocEntry {
  id: string;
  /** Source path (content-layer entries carry it); used to spot folder index files. */
  filePath?: string;
  data: {
    title: string;
    order?: number;
    description?: string;
    collapsed?: boolean;
    group?: string;
    parent?: string;
    sidebarLabel?: string;
  };
}

export interface TreePage {
  kind: 'page';
  id: string;
  title: string;
  /** Sidebar row text: frontmatter `sidebarLabel`, else `title`. */
  label: string;
  order?: number;
  href: string;
  /** Sidebar group id (frontmatter `group`). */
  group?: string;
  /** File stem of the sibling page this page nests under (frontmatter `parent`). */
  parent?: string;
  /** Sibling pages whose `parent` points at this page, sorted. Rendered indented. */
  children?: TreePage[];
}

export interface TreeGroup {
  kind: 'group';
  id: string;
  label: string;
  children: Array<TreePage | TreeSection>;
}

export interface TreeSection {
  kind: 'section';
  name: string;
  order?: number;
  group?: string;
  defaultCollapsed: boolean;
  indexPage?: TreePage;
  /** Top-level nodes in display order (grouped nodes first, by group order). */
  children: Array<TreePage | TreeSection>;
  /**
   * Present only when at least one child has a `group`: the same nodes as
   * `children`, bucketed for rendering. Ungrouped nodes come after the groups.
   */
  groups?: TreeGroup[];
  ungrouped?: Array<TreePage | TreeSection>;
}

/** Sidebar groups for docs/language/, in display order. */
export const LANGUAGE_GROUPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'basics', label: 'basics' },
  { id: 'expressions', label: 'statements & expressions' },
  { id: 'types', label: 'types' },
  { id: 'abstraction', label: 'abstraction' },
  { id: 'conversions', label: 'conversions' },
  { id: 'memory', label: 'memory & concurrency' },
  { id: 'errors', label: 'errors' },
  { id: 'compile-time', label: 'compile time' },
  { id: 'modules', label: 'program structure' },
  { id: 'interop', label: 'interop' },
];

/** Group definitions per section name. Sections not listed use first-seen order. */
const SECTION_GROUPS: Record<string, ReadonlyArray<{ id: string; label: string }>> = {
  language: LANGUAGE_GROUPS,
};

/** Canonical URL path for a doc id. Always ends with "/" (trailingSlash: 'always'). */
export function docHref(id: string): string {
  const clean = id.replace(/\.mdx?$/, '').replace(/\/index$/, '');
  if (!clean || clean === 'index') return '/docs/';
  return `/docs/${clean}/`;
}

export function formatSectionName(name: string): string {
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fileStem(id: string): string {
  const parts = id.replace(/\.mdx?$/, '').split('/');
  return parts[parts.length - 1];
}

export function buildDocTree(docs: DocEntry[]): TreeSection {
  const root: TreeSection = { kind: 'section', name: '', defaultCollapsed: false, children: [] };

  // The glob loader drops "/index" from ids ("language/index.mdx" -> id
  // "language"), so a folder's index file is recognised by its source path.
  // It becomes that folder's index page (the directory label links to it)
  // when the folder holds other pages; a lone index file stays a page.
  const ids = docs.map(d => d.id.replace(/\.mdx?$/, ''));
  const isFolderIndex = (doc: DocEntry, slug: string) =>
    slug !== 'index' &&
    /(^|\/)index\.mdx?$/.test(doc.filePath ?? '') &&
    ids.some(other => other.startsWith(slug + '/'));

  for (const doc of docs) {
    let slug = doc.id.replace(/\.mdx?$/, '');
    if (isFolderIndex(doc, slug)) slug += '/index';
    const parts = slug.split('/');
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);

    let node = root;
    for (const seg of dirParts) {
      let child = node.children.find(
        (c): c is TreeSection => c.kind === 'section' && c.name === seg
      );
      if (!child) {
        child = { kind: 'section', name: seg, defaultCollapsed: false, children: [] };
        node.children.push(child);
      }
      node = child;
    }

    const page: TreePage = {
      kind: 'page',
      id: doc.id,
      title: doc.data.title,
      label: doc.data.sidebarLabel ?? doc.data.title,
      order: doc.data.order,
      href: docHref(doc.id),
      group: doc.data.group,
      parent: doc.data.parent,
    };

    if (fileName === 'index') {
      node.indexPage = page;
      node.order = doc.data.order;
      node.group = doc.data.group;
      node.defaultCollapsed = doc.data.collapsed ?? false;
    } else {
      node.children.push(page);
    }
  }

  sortSection(root);
  return root;
}

function nodeName(n: TreePage | TreeSection): string {
  return n.kind === 'page' ? n.title : n.name;
}

/** Sort by `order`; unordered nodes go last, by title/name. */
function sortNodes<T extends TreePage | TreeSection>(nodes: T[]): T[] {
  const withOrder = nodes.filter(c => c.order !== undefined);
  const withoutOrder = nodes.filter(c => c.order === undefined);
  withOrder.sort((a, b) => a.order! - b.order!); // stable: ties keep load order, as before
  withoutOrder.sort((a, b) => nodeName(a).localeCompare(nodeName(b)));
  return [...withOrder, ...withoutOrder];
}

/**
 * Move pages with `parent: <stem>` under the sibling page with that stem.
 * Unknown parents (or a page naming itself) leave the page at section level.
 * Nesting may be several levels deep; cycles are broken by leaving the page
 * at section level.
 */
function nestChildren(section: TreeSection): void {
  const pages = section.children.filter((c): c is TreePage => c.kind === 'page');
  const byStem = new Map(pages.map(p => [fileStem(p.id), p]));

  const resolvesToRoot = (p: TreePage): boolean => {
    const seen = new Set<TreePage>();
    let cur: TreePage | undefined = p;
    while (cur?.parent) {
      if (seen.has(cur)) return false;
      seen.add(cur);
      cur = byStem.get(cur.parent);
      if (!cur) return true; // dangling parent: cur stays at root, chain ends there
    }
    return true;
  };

  const nested = new Set<TreePage>();
  for (const p of pages) {
    if (!p.parent) continue;
    const parent = byStem.get(p.parent);
    if (!parent || parent === p || !resolvesToRoot(p)) continue;
    (parent.children ??= []).push(p);
    nested.add(p);
  }
  if (!nested.size) return;

  section.children = section.children.filter(c => !(c.kind === 'page' && nested.has(c)));
  for (const p of pages) if (p.children) p.children = sortNodes(p.children);
}

function sortSection(section: TreeSection): void {
  nestChildren(section);
  const sorted = sortNodes(section.children);

  const hasGroups = sorted.some(c => c.group);
  if (!hasGroups) {
    section.children = sorted;
  } else {
    const defs = SECTION_GROUPS[section.name] ?? [];
    const groups: TreeGroup[] = defs.map(d => ({ kind: 'group', id: d.id, label: d.label, children: [] }));
    const ungrouped: Array<TreePage | TreeSection> = [];
    for (const node of sorted) {
      if (!node.group) { ungrouped.push(node); continue; }
      let g = groups.find(x => x.id === node.group);
      if (!g) {
        // Unknown group id: append after the known groups, labelled by its id.
        g = { kind: 'group', id: node.group, label: node.group.replace(/-/g, ' '), children: [] };
        groups.push(g);
      }
      g.children.push(node);
    }
    section.groups = groups.filter(g => g.children.length > 0);
    section.ungrouped = ungrouped;
    section.children = [...section.groups.flatMap(g => g.children), ...ungrouped];
  }

  for (const child of section.children) {
    if (child.kind === 'section') sortSection(child);
  }
}

function pushPage(pages: TreePage[], page: TreePage): void {
  pages.push(page);
  for (const c of page.children ?? []) pushPage(pages, c);
}

/** All pages in sidebar display order used for prev/next navigation. */
export function flattenPages(section: TreeSection): TreePage[] {
  const pages: TreePage[] = [];

  if (section.indexPage) {
    pages.push(section.indexPage);
  }

  for (const child of section.children) {
    if (child.kind === 'section') {
      pages.push(...flattenPages(child));
    } else {
      pushPage(pages, child);
    }
  }

  return pages;
}

/**
 * The directory node at a slash-separated path below the root ("language",
 * "library/core"), or undefined. Segments are doc-id segments (lowercase).
 */
export function findSection(root: TreeSection, path: string): TreeSection | undefined {
  let node: TreeSection | undefined = root;
  for (const seg of path.split('/').filter(Boolean)) {
    node = node.children.find((c): c is TreeSection => c.kind === 'section' && c.name === seg);
    if (!node) return undefined;
  }
  return node;
}

/**
 * Source file of a doc below the docs root ("language/index.mdx",
 * "library/Core/std/range/index.mdx"), or undefined without a filePath.
 * Unlike the id it keeps folder index files apart: the glob loader gives
 * "language/index.mdx" the id "language".
 */
export function docSourcePath(doc: Pick<DocEntry, 'filePath'>): string | undefined {
  return doc.filePath?.replace(/^.*?src\/content\/docs\//, '');
}

/** Top-level section name for a doc id or source path (search, llms.txt). */
export function sectionFromId(id: string): string {
  const parts = id.replace(/\.mdx?$/, '').split('/');
  if (parts.length <= 1) return 'Docs';
  return formatSectionName(parts[0]);
}
