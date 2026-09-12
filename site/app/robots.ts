import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/site'

/**
 * Nothing here is private, so everything is crawlable. The file exists for the
 * sitemap line: without it the host serves its own default robots.txt, which
 * names no sitemap.
 *
 * Author: Gowtham
 */
// Required by output: 'export'. These are route handlers, so Next.js refuses to
// emit them as files until the route says it never depends on a request.
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
