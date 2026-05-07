/**
 * remark-callouts.mjs
 *
 * Transforms GitHub-style blockquote alerts into styled callout divs.
 *
 * Syntax (in markdown / MDX):
 *
 *   > [!NOTE]
 *   > This is a note.
 *
 *   > [!WARNING]
 *   > This is a warning.
 *
 * Supported types: NOTE, TIP, IMPORTANT, WARNING, CAUTION
 *
 * Output HTML:
 *   <div class="callout callout-warning" role="note">
 *     <div class="callout-indicator">
 *       <svg .../>
 *       <span>Warning</span>
 *     </div>
 *     <div class="callout-content">
 *       <p>This is a warning.</p>
 *     </div>
 *   </div>
 */

import { visit } from 'unist-util-visit';

const CALLOUT_TYPES = {
  NOTE: {
    label: 'Note',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  },
  TIP: {
    label: 'Tip',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m15.5 7.5 2.8-2.8"/><path d="M20 12h-4"/><path d="m15.5 16.5 2.8 2.8"/><path d="M12 18v4"/><path d="m4.2 19.8 2.8-2.8"/><path d="M4 12h4"/><path d="m4.2 4.2 2.8 2.8"/></svg>',
  },
  IMPORTANT: {
    label: 'Important',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  },
  WARNING: {
    label: 'Warning',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  },
  CAUTION: {
    label: 'Caution',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  },
};

const CALLOUT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

export default function remarkCallouts() {
  return (tree) => {
    visit(tree, 'blockquote', (node, index, parent) => {
      // The first child should be a paragraph whose first text starts with [!TYPE]
      const firstChild = node.children?.[0];
      if (!firstChild || firstChild.type !== 'paragraph') return;

      const firstInline = firstChild.children?.[0];
      if (!firstInline || firstInline.type !== 'text') return;

      const match = firstInline.value.match(CALLOUT_RE);
      if (!match) return;

      const typeKey = match[1].toUpperCase();
      const config = CALLOUT_TYPES[typeKey];
      if (!config) return;

      // Strip the [!TYPE] marker from the text
      firstInline.value = firstInline.value.slice(match[0].length);

      // If the first paragraph is now empty text, remove that text node
      if (firstInline.value === '' && firstChild.children.length === 1) {
        // The whole first paragraph was just the marker — remove it
        node.children.shift();
      } else if (firstInline.value === '') {
        // Remove the empty text node but keep other inline children
        firstChild.children.shift();
      }

      // Build the callout indicator as raw HTML
      const indicator = {
        type: 'html',
        value: `<div class="callout-indicator">${config.icon}<span>${config.label}</span></div>`,
      };

      // Wrap remaining blockquote children in a content div
      const contentChildren = node.children.map((child) => child);

      const contentOpen = { type: 'html', value: '<div class="callout-content">' };
      const contentClose = { type: 'html', value: '</div>' };

      // Replace the blockquote with a div
      const calloutOpen = {
        type: 'html',
        value: `<div class="callout callout-${typeKey.toLowerCase()}" role="note">`,
      };
      const calloutClose = { type: 'html', value: '</div>' };

      const newNodes = [
        calloutOpen,
        indicator,
        contentOpen,
        ...contentChildren,
        contentClose,
        calloutClose,
      ];

      parent.children.splice(index, 1, ...newNodes);
    });
  };
}
