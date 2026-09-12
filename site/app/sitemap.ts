import type { MetadataRoute } from 'next'

import { DOCS_SLUGS } from '@/lib/nav'
import { SITE_URL } from '@/lib/site'

/**
 * Every page the export produces, derived from the documentation navigation so
 * a page added there is listed here with no second edit.
 *
 * The introduction is listed only as /docs. It is served at both addresses, and
 * offering search engines both makes the two compete for the same page.
 *
 * No lastModified: it would be the build time rather than the time the page
 * changed, which tells a crawler that everything changed whenever anything did.
 *
 * Author: Gowtham
 */
// Required by output: 'export'. These are route handlers, so Next.js refuses to
// emit them as files until the route says it never depends on a request.
export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    '/',
    '/docs',
    ...DOCS_SLUGS.filter((slug) => slug !== 'introduction').map((slug) => `/docs/${slug}`),
  ]

  return paths.map((path) => ({ url: `${SITE_URL}${path}` }))
}
