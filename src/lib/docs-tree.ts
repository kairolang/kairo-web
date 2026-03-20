export interface DocEntry {
  id: string;
  data: { title: string; order?: number; description?: string; collapsed?: boolean };
}

export interface TreePage {
  kind: 'page';
  id: string;
  title: string;
  order?: number;
  href: string;
}

export interface TreeSection {
  kind: 'section';
  name: string;
  order?: number;
  defaultCollapsed: boolean;
  indexPage?: TreePage;
  children: Array<TreePage | TreeSection>;
}

export function docHref(id: string): string {
  const clean = id.replace(/\.mdx?$/, '').replace(/\/index$/, '');
  if (!clean || clean === 'index') return '/docs';
  return `/docs/${clean}`;
}

export function formatSectionName(name: string): string {
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function buildDocTree(docs: DocEntry[]): TreeSection {
  const root: TreeSection = { kind: 'section', name: '', defaultCollapsed: false, children: [] };

  for (const doc of docs) {
    const slug = doc.id.replace(/\.mdx?$/, '');
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
      order: doc.data.order,
      href: docHref(doc.id),
    };

    if (fileName === 'index') {
      node.indexPage = page;
      node.order = doc.data.order;
      node.defaultCollapsed = doc.data.collapsed ?? false;
    } else {
      node.children.push(page);
    }
  }

  sortSection(root);
  return root;
}

function sortSection(section: TreeSection): void {
  const withOrder = section.children.filter(c => c.order !== undefined);
  const withoutOrder = section.children.filter(c => c.order === undefined);

  withOrder.sort((a, b) => a.order! - b.order!);
  withoutOrder.sort((a, b) => {
    const na = a.kind === 'page' ? a.title : a.name;
    const nb = b.kind === 'page' ? b.title : b.name;
    return na.localeCompare(nb);
  });

  section.children = [...withOrder, ...withoutOrder];

  for (const child of section.children) {
    if (child.kind === 'section') sortSection(child);
  }
}

/** All pages in sidebar display order — used for prev/next navigation. */
export function flattenPages(section: TreeSection): TreePage[] {
  const pages: TreePage[] = [];

  if (section.indexPage) {
    pages.push(section.indexPage);
  }

  for (const child of section.children) {
    if (child.kind === 'section') {
      pages.push(...flattenPages(child));
    } else {
      pages.push(child);
    }
  }

  return pages;
}

/** Top-level section name for a doc id — used in search. */
export function sectionFromId(id: string): string {
  const parts = id.replace(/\.mdx?$/, '').split('/');
  if (parts.length <= 1) return 'Docs';
  return formatSectionName(parts[0]);
}
