/**
 * Copies LICENSE and NOTICE from the repository root into the package before it
 * is packed.
 *
 * npm publishes the package directory, not the repository, so without this the
 * two files Apache-2.0 requires to travel with the work are left behind: section
 * 4(a) requires a copy of the license and 4(d) the NOTICE. They are copied rather
 * than committed here so the repository root stays their only source.
 *
 * Author: Gowtham
 */

import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.join(here, '..', '..', '..')
const packageRoot = path.join(here, '..')

for (const name of ['LICENSE', 'NOTICE']) {
  await copyFile(path.join(repositoryRoot, name), path.join(packageRoot, name))
  console.log(`copy-legal: ${name}`)
}
