import { getAllDocs, getHeadings } from './docs'
import { getSection } from './nav'

/**
 * The docs search index: every page and every section heading in it.
 *
 * Built once at build time from the same MDX the pages render, so search can never
 * offer a page or a heading that does not exist. It is small enough to ship with the
 * page, which means searching needs no server and no third-party service.
 *
 * Author: Gowtham
 */

export interface SearchEntry {
  href: string
  /** The page title for a page, the heading text for a heading. */
  title: string
  /** The page a heading belongs to; the page itself for a page. */
  page: string
  section: string
  kind: 'page' | 'heading'
  description: string
}

export async function getSearchIndex(): Promise<SearchEntry[]> {
  const docs = await getAllDocs()

  return docs.flatMap((doc) => {
    const href = `/docs/${doc.slug}`
    const section = getSection(doc.slug)
    const page: SearchEntry = { href, title: doc.title, page: doc.title, section, kind: 'page', description: doc.description }
    const headings = getHeadings(doc.body).map<SearchEntry>((heading) => ({
      href: `${href}#${heading.id}`,
      title: heading.text,
      page: doc.title,
      section,
      kind: 'heading',
      description: '',
    }))
    return [page, ...headings]
  })
}
