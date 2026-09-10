import type { NextConfig } from 'next'

/**
 * The site is fully static: every page is a marketing page or a docs page
 * compiled from MDX at build time, so there is nothing to render per request.
 * It is exported as plain files, which Cloudflare serves as a Worker's static assets.
 *
 * Author: Gowtham
 */
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  // A static export has no server to run the image optimizer, and the one image
  // is an SVG, which the optimizer would pass through unchanged anyway.
  images: { unoptimized: true },
  // MDX is compiled through next-mdx-remote at build time rather than by a
  // webpack loader, so no page extension changes are needed here.
  experimental: {
    optimizePackageImports: ['shiki'],
  },
}

export default nextConfig
