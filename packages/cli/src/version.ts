/**
 * @nextship/cli: the installed version
 *
 * Read once from the package manifest. It is reported by `--version` and folded
 * into the build digest, so upgrading nextship produces a new deployment id even
 * when nothing in the project changed.
 *
 * Author: Gowtham
 */

import { createRequire } from 'node:module'

export const VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version
