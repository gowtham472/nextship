/**
 * The documentation outline.
 *
 * Declared here rather than derived from the filesystem, because reading order
 * is an editorial decision: a directory listing would sort "commands" before
 * "installation" and quietly teach the wrong sequence. `getDocsTree` checks
 * this list against the files on disk, so a page can never be added without
 * being placed, or renamed without the link breaking the build.
 *
 * Author: Gowtham
 */

export interface NavItem {
  /** Slug under /docs, matching the MDX filename without its extension. */
  slug: string
  title: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const DOCS_NAV: NavSection[] = [
  {
    title: 'Getting started',
    items: [
      { slug: 'introduction', title: 'Introduction' },
      { slug: 'requirements', title: 'Requirements' },
      { slug: 'installation', title: 'Installation' },
      { slug: 'quick-start', title: 'Quick start' },
    ],
  },
  {
    title: 'Guides',
    items: [
      { slug: 'deploying', title: 'Deploying' },
      { slug: 'environment-variables', title: 'Environment variables' },
      { slug: 'custom-domains', title: 'Custom domains' },
      { slug: 'rollbacks-and-logs', title: 'Rollbacks and logs' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { slug: 'commands', title: 'CLI reference' },
      { slug: 'how-it-works', title: 'How it works' },
      { slug: 'security', title: 'Security' },
      { slug: 'evidence', title: 'Evidence' },
    ],
  },
]

/** Every slug in reading order, used for the previous and next links. */
export const DOCS_ORDER: NavItem[] = DOCS_NAV.flatMap((section) => section.items)

export const DOCS_SLUGS: string[] = DOCS_ORDER.map((item) => item.slug)

/** The title of the section a page sits in, for breadcrumbs and search results. */
export function getSection(slug: string): string {
  const section = DOCS_NAV.find((candidate) => candidate.items.some((item) => item.slug === slug))
  if (!section) throw new Error(`No section in lib/nav.ts lists the page "${slug}".`)
  return section.title
}

/** The neighbours of a page, for the footer links. `null` at either end. */
export function getNeighbours(slug: string): { previous: NavItem | null; next: NavItem | null } {
  const index = DOCS_ORDER.findIndex((item) => item.slug === slug)
  if (index === -1) return { previous: null, next: null }

  return {
    previous: DOCS_ORDER[index - 1] ?? null,
    next: DOCS_ORDER[index + 1] ?? null,
  }
}
