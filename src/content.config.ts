import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().optional(),
    /** Sidebar group id within a section (see LANGUAGE_GROUPS in lib/docs-tree.ts). */
    group: z.string().optional(),
    /** File stem of a sibling page this page nests under in the sidebar. */
    parent: z.string().optional(),
    collapsed: z.boolean().optional(),
    prev: z.object({ href: z.string(), title: z.string() }).nullish(),
    next: z.object({ href: z.string(), title: z.string() }).nullish(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    author: z.string().default('Kairo Team'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { docs, blog };
