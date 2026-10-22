/**
 * Docs hub components: building blocks for landing pages written as MDX
 * (frontmatter `template: hub`), e.g. src/content/docs/index.mdx.
 *
 * The docs route passes this map to <Content components={hubComponents} />,
 * so hub MDX files use the components by name without import lines (which
 * keeps the files portable, and keeps import noise out of search/llms text).
 * Each component documents its props in its own header comment.
 *
 * Layout        HubHero, HubSearch, HubNotice, HubSection, HubGrid
 * Cards         HubCard (Markdown link tree), PathCard (reading path),
 *               StatusCard (status rows + links)
 * Generated     LanguageMap (topic groups of a folder), ModuleIndex
 *               (sub-folders as modules), RecentlyUpdated (git lastmod)
 * Behaviour     AnchorForward (old #anchors -> their new page)
 *
 * Shared styles live in hub.css. The components do not import it (that
 * would put it in the CSS of every page on the route); the page layout links
 * it on hub pages only (layouts/DocsLayout.astro, `hub.css?url`).
 *
 * Requirements: the components only work inside a `.docs-hub` wrapper with
 * hub.css loaded. The wrapper is the size container `hub` that every column
 * count and narrow-card rule queries, and it scopes the base styles (mono
 * type, list resets, link colours). DocsLayout provides both for pages with
 * `template: hub` (<article class="docs-hub">); anywhere else, add the
 * wrapper and link hub.css yourself.
 */
import AnchorForward from './AnchorForward.astro';
import HubCard from './HubCard.astro';
import HubGrid from './HubGrid.astro';
import HubHero from './HubHero.astro';
import HubNotice from './HubNotice.astro';
import HubSearch from './HubSearch.astro';
import HubSection from './HubSection.astro';
import LanguageMap from './LanguageMap.astro';
import ModuleIndex from './ModuleIndex.astro';
import PathCard from './PathCard.astro';
import RecentlyUpdated from './RecentlyUpdated.astro';
import StatusCard from './StatusCard.astro';

export const hubComponents = {
  AnchorForward,
  HubCard,
  HubGrid,
  HubHero,
  HubNotice,
  HubSearch,
  HubSection,
  LanguageMap,
  ModuleIndex,
  PathCard,
  RecentlyUpdated,
  StatusCard,
};
