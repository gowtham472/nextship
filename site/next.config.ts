import type { NextConfig } from 'next'

/**
 * The site is fully static: every page is a marketing page or a docs page
 * compiled from MDX at build time, so there is nothing to render per request.
 *
 * Author: Gowtham
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // MDX is compiled through next-mdx-remote at build time rather than by a
  // webpack loader, so no page extension changes are needed here.
  experimental: {
    optimizePackageImports: ['shiki'],
  },
}

export default nextConfig
