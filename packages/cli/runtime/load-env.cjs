/**
 * nextship: env file loader
 *
 * Reads a project's env files using `@next/env`, which is the package Next.js
 * itself uses to load them. Parity with the build is the whole point: a
 * hand-written dotenv parser agreed with Next.js on simple lines and disagreed
 * on the ones that matter, silently truncating a multi-line private key,
 * mangling a quoted value followed by a comment containing a quote, and never
 * expanding `$VAR`. Every one of those produced a value that deployed cleanly
 * and failed at request time. Using Next.js's own loader makes agreement
 * structural rather than something to keep testing for.
 *
 * This runs as its own process for two reasons. `loadEnvConfig` assigns into
 * `process.env`, which would otherwise pollute the CLI and the environment it
 * hands to `docker build`. And the parent can then give this process a minimal
 * environment, so that variable expansion cannot reach a developer's real
 * environment: without that, a line like `TOKEN=$DIGITALOCEAN_TOKEN` in a
 * project's `.env` would expand to the live API token and be uploaded to the
 * deployment target.
 *
 * Usage: node load-env.cjs <project-dir>
 * Prints JSON: { "variables": { KEY: value }, "files": ["<absolute path>"] }
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §10.3
 */

'use strict'

const path = require('path')

const projectDir = process.argv[2]
if (!projectDir) {
  process.stderr.write('load-env.cjs requires a project directory\n')
  process.exit(1)
}

/**
 * Finds `@next/env`, which belongs to the project's own Next.js install.
 *
 * It is a dependency of `next`, not of the app, so pnpm never links it at the
 * top of the project's node_modules and resolving from the project directory
 * alone fails on every pnpm project. Resolving from `next`'s own location works
 * for every package manager, because that is where its dependencies live. The
 * project directory is still tried first, for a hoisted layout that shadows it.
 */
function resolveNextEnv() {
  const attempts = [projectDir]

  try {
    attempts.push(path.dirname(require.resolve('next/package.json', { paths: [projectDir] })))
  } catch {
    // Reported below with the rest, so the message names both failures at once.
  }

  for (const base of attempts) {
    try {
      return require(require.resolve('@next/env', { paths: [base] }))
    } catch {
      continue
    }
  }
  return null
}

const nextEnv = resolveNextEnv()
if (!nextEnv) {
  process.stderr.write(
    `@next/env could not be resolved from ${projectDir} or from the project's Next.js install. ` +
      'Run your package manager install command, then try again.\n'
  )
  process.exit(1)
}

const loadEnvConfig = nextEnv.loadEnvConfig

if (typeof loadEnvConfig !== 'function') {
  process.stderr.write('@next/env resolved but does not export loadEnvConfig\n')
  process.exit(1)
}

// `dev: false` selects the production files, in the order Next.js loads them for
// a production build.
const result = loadEnvConfig(projectDir, false, { info: () => {}, error: () => {} })

// `parsedEnv` holds only what the files defined. `combinedEnv` is that merged
// over the whole ambient environment, so using it here would upload every
// variable this process happens to hold, including the API token the CLI was
// given, to the deployment target.
const variables = result.parsedEnv ?? {}

process.stdout.write(
  JSON.stringify({
    variables,
    files: (result.loadedEnvFiles || []).map((file) => path.resolve(file.path)),
  })
)
