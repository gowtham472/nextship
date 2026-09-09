/**
 * Copies the built adapter into the CLI's runtime assets.
 *
 * The adapter is not a runtime dependency of the published package, it is a file
 * the CLI copies into a build context. Declaring it as a dependency made the CLI
 * unpublishable: `workspace:*` cannot be resolved from a registry, so installing
 * `nextship` from npm would have produced a CLI that could not find its own
 * adapter on the first build.
 *
 * It stays a workspace devDependency so pnpm still builds it first, and lands
 * here beside prune.cjs and load-env.cjs, which are the other files shipped to be
 * copied rather than imported.
 *
 * Author: Gowtham
 */

import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(here, '..', '..', 'adapter', 'dist', 'index.js')
const destination = path.join(here, '..', 'runtime', 'adapter.mjs')

try {
  await stat(source)
} catch {
  console.error(
    `bundle-adapter: ${source} does not exist.\n` +
      'Build the adapter first. `pnpm build` at the workspace root does this in order.'
  )
  process.exit(1)
}

await mkdir(path.dirname(destination), { recursive: true })
await copyFile(source, destination)
console.log(`bundle-adapter: runtime/adapter.mjs <- ${path.relative(path.join(here, '..', '..', '..'), source)}`)
