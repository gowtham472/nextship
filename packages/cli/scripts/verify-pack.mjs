/**
 * Packs the CLI, installs the tarball into an empty project, and checks that what a
 * user receives is complete and runs.
 *
 * The installed package is checked rather than the workspace because the two have
 * differed in exactly the ways that broke releases: npm dropped a malformed bin
 * entry with only a warning, a rename left checks looking for a directory that no
 * longer existed, and a version shipped without its README, LICENSE and NOTICE.
 * Each of those passed every check that looked at the source tree.
 *
 * ci.yml runs this on every push and pull request and release.yml runs it before
 * staging, so a release is never the first time a package is checked.
 *
 * Author: Gowtham
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

/** The adapter is copied into every build; the rest are the README and what Apache-2.0 requires. */
const REQUIRED = ['runtime/adapter.mjs', 'README.md', 'LICENSE', 'NOTICE']

const fail = (message) => {
  throw new Error(message)
}

const work = mkdtempSync(path.join(tmpdir(), 'nextship-verify-'))

try {
  // Packing runs prepack, which copies LICENSE and NOTICE in. The tarball is found
  // by listing the destination rather than by parsing npm's output, which the
  // lifecycle scripts write into as well.
  execSync(`npm pack --pack-destination "${work}"`, { cwd: packageRoot, stdio: 'inherit' })
  const tarballs = readdirSync(work).filter((file) => file.endsWith('.tgz'))
  if (tarballs.length !== 1) fail(`expected one tarball, found ${tarballs.length}`)

  const project = path.join(work, 'project')
  mkdirSync(project)
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'verify-pack', private: true }))
  execSync(`npm install --no-audit --no-fund --loglevel=error "${path.join(work, tarballs[0])}"`, {
    cwd: project,
    stdio: 'inherit',
  })

  const installed = path.join(project, 'node_modules', manifest.name)
  const missing = REQUIRED.filter((file) => !existsSync(path.join(installed, file)))
  if (missing.length > 0) fail(`missing from the installed package: ${missing.join(', ')}`)

  const installedManifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
  if (!installedManifest.bin?.nextship) fail('the installed package declares no nextship binary')

  // The command is resolved the way a shell resolves it, through node_modules/.bin
  // on PATH, rather than by running dist/index.js: that file runs even when npm has
  // dropped the bin entry and the command does not exist. Windows names the
  // variable Path, and setting PATH beside it leaves the child choosing between two.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  const env = {
    ...process.env,
    [pathKey]: `${path.join(project, 'node_modules', '.bin')}${path.delimiter}${process.env[pathKey] ?? ''}`,
  }
  const reported = execSync('nextship --version', { cwd: project, env, encoding: 'utf8' }).trim()
  if (reported !== manifest.version) fail(`the installed command reports ${reported}, expected ${manifest.version}`)

  console.log(
    `verify-pack: ${manifest.name}@${manifest.version} installs with ${REQUIRED.join(', ')}, ` +
      `and the nextship command reports ${reported}`
  )
} catch (error) {
  console.error(`verify-pack: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  rmSync(work, { recursive: true, force: true })
}
