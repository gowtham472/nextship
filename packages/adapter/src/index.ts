/**
 * @nextship/adapter: Next.js Deployment Adapter
 *
 * Copied into the build context and injected through the NEXT_ADAPTER_PATH
 * environment variable by the nextship CLI, so the user's next.config.js is
 * never modified and the adapter is never a dependency of the user's project.
 *
 * `modifyConfig` applies the settings a container deployment requires and the
 * user should not have to know about. `onBuildComplete` writes the manifest that
 * proves the adapter ran and records what it was given.
 *
 * The hook signatures follow the public Adapter API stabilised in Next.js 16.2.
 * This file must stay free of imports beyond node builtins, because it is
 * copied as a single file.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §5, §6
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUTPUT_DIR = '.nextship/output'
const MANIFEST_VERSION = 1

export async function modifyConfig(config: NextConfig): Promise<NextConfig> {
  return {
    ...config,

    // Stamps ?dpl= onto assets and x-deployment-id onto navigations, so a client
    // running an older build hard navigates instead of requesting chunks and
    // Server Action ids that the new build no longer has. Supplied by the CLI,
    // which derives it from the commit.
    deploymentId: process.env.NEXTSHIP_DEPLOYMENT_ID,

    async headers() {
      const existing = (await config.headers?.()) ?? []
      return [
        ...existing,
        {
          // A buffering reverse proxy leaves streaming apparently working while
          // delivering none of it: Suspense boundaries and Partial Prerendering
          // arrive as one response at the end. nginx honours this header.
          source: '/:path*{/}?',
          headers: [{ key: 'X-Accel-Buffering', value: 'no' }],
        },
      ]
    },
  }

  // Deliberately absent: `output: 'standalone'`.
  //
  // Verified against Next.js 16.3.4: setting it while an adapter is configured
  // fails the build with ENOENT on `.next/next-server.js.nft.json`, leaving a
  // standalone directory with no server.js. This reproduces with a completely
  // no-op adapter, so it is the combination that breaks, not this adapter. The
  // CLI assembles the equivalent tree itself from the same trace files.
  // See docs/design.md §12.
}

/**
 * The manifest carries exactly the fields the CLI reads: the version it checks
 * for compatibility, the build id it reports, the deployment id it verifies was
 * applied, the framework version that actually ran, and a route the health check
 * can poll without rendering. It is versioned, so
 * later versions add fields in the change that starts consuming them.
 */
export async function onBuildComplete(context: BuildCompleteContext): Promise<void> {
  const outputDir = path.join(context.projectDir, OUTPUT_DIR)

  const manifest = {
    version: MANIFEST_VERSION,
    buildId: context.buildId,
    deploymentId: context.config.deploymentId,
    framework: { name: 'next', version: context.nextVersion },
    healthPath: await resolveHealthPath(context.projectDir),
  }

  await mkdir(outputDir, { recursive: true })
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

/**
 * Picks a route the platform's health check can poll cheaply.
 *
 * A health check runs every few seconds forever, so pointing it at a route that
 * renders on every request is a standing cost for as long as the app exists. A
 * statically prerendered route is served from disk instead.
 *
 * `/` is preferred when it is static, because a health check should exercise
 * the path users actually take. Otherwise any prerendered route will do: it
 * still proves the server is up and serving. When nothing is prerendered there
 * is nothing cheap to offer, and `null` lets the CLI fall back to `/` and say
 * what that costs.
 *
 * Read from the prerender manifest on disk rather than from the build context,
 * so this depends only on a file Next.js has always written.
 */
async function resolveHealthPath(projectDir: string): Promise<string | null> {
  let routes: Record<string, PrerenderedRoute>
  try {
    const contents = await readFile(path.join(projectDir, '.next', 'prerender-manifest.json'), 'utf8')
    routes = (JSON.parse(contents) as { routes?: Record<string, PrerenderedRoute> }).routes ?? {}
  } catch {
    // No manifest, or unreadable: not worth failing a build over, and the CLI
    // handles the absence.
    return null
  }

  return chooseHealthPath(routes)
}

/** A prerendered route as the manifest records it, reduced to what the choice reads. */
export interface PrerenderedRoute {
  initialStatus?: number
  dataRoute?: string | null
}

/**
 * Picks the prerendered route a health check can poll and expect a 2xx from.
 *
 * Next.js prerenders its own internal pages alongside the app's. Taking the first
 * route in sorted order chose `/_global-error` for any app whose `/` is dynamic,
 * because an underscore sorts before letters, and that page answers 500 by design,
 * so every deploy of such an app failed its health checks. The manifest does not
 * record that route's status, so status alone cannot exclude it: any path segment
 * starting with an underscore is internal, since App Router treats those folders as
 * private and never routes to them.
 *
 * Pages come before other prerendered outputs such as `/favicon.ico`, because a page
 * is what visitors request. Each group is sorted so the same build always chooses
 * the same route, which keeps the deployed spec stable across rebuilds.
 */
export function chooseHealthPath(routes: Record<string, PrerenderedRoute>): string | null {
  const healthy = Object.entries(routes).filter(
    ([route, entry]) =>
      !route.split('/').some((segment) => segment.startsWith('_')) &&
      (entry.initialStatus === undefined || (entry.initialStatus >= 200 && entry.initialStatus < 300))
  )

  if (healthy.some(([route]) => route === '/')) return '/'

  const pages = healthy.filter(([, entry]) => entry.dataRoute).map(([route]) => route)
  const others = healthy.filter(([, entry]) => !entry.dataRoute).map(([route]) => route)
  return pages.sort()[0] ?? others.sort()[0] ?? null
}

export default { name: 'nextship', modifyConfig, onBuildComplete }

/**
 * Local shapes covering the fields this adapter reads. Replace with the types
 * exported by Next.js once they are published from a stable entry point.
 */
interface NextConfig {
  deploymentId?: string
  headers?: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>
  [key: string]: unknown
}

interface BuildCompleteContext {
  projectDir: string
  buildId: string
  nextVersion: string
  config: NextConfig
}
