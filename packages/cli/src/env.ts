/**
 * @nextship/cli: runtime environment variables
 *
 * A deployed container starts with nothing in its environment. Env files are
 * mounted as build secrets and never enter an image layer, which is what keeps
 * secrets out of the registry, but it also means nothing survives to runtime.
 * Values Next.js inlines at build time, such as `NEXT_PUBLIC_*`, still work;
 * anything read at request time, such as a database URL, is undefined.
 *
 * Uploading the project's env files is deliberately a separate command rather
 * than part of `deploy`. A local `.env` usually holds development values, and
 * pushing those into production as a side effect of deploying is the kind of
 * surprise that costs someone a real outage. Making it explicit costs one
 * command and removes that whole class of accident.
 *
 * Values are read by `@next/env`, the loader Next.js itself uses, rather than by
 * a parser of our own. See `runtime/load-env.cjs` for why.
 *
 * Author: Gowtham
 * Roadmap: ../../../docs/roadmap.md v0.4
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { ownedApp } from './owned-app.js'
import { captureStrict } from './util/exec.js'
import { detail, ok, step, warn } from './util/log.js'

/**
 * Variables that change how the container runs. The image sets these itself, so
 * a pushed value silently overrides it, and a stale `NODE_ENV=development` in a
 * local file would put the production container into development mode.
 */
const RUNTIME_CRITICAL = new Set(['NODE_ENV', 'PORT', 'HOSTNAME'])


export interface EnvOptions {
  confirmed: boolean
}

export interface RemoveOptions extends EnvOptions {
  keys: string[]
}

// ------------------------------------------------------------------ reading

/**
 * Reads the project's env files through Next.js's own loader.
 *
 * The child process is given a deliberately minimal environment. `@next/env`
 * expands `$VAR` references, and expansion resolves against the environment it
 * runs in, so inheriting this process's environment would let a line such as
 * `TOKEN=$DIGITALOCEAN_TOKEN` in a project's `.env` resolve to the live API
 * token and be uploaded to the deployment target.
 */
export async function collectEnv(project: ProjectInfo): Promise<Map<string, string>> {
  const script = resolveLoader()

  const output = await captureStrict(process.execPath, [script, project.root], {
    cwd: project.root,
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' },
  })

  let parsed: { variables?: Record<string, string> }
  try {
    parsed = JSON.parse(output) as { variables?: Record<string, string> }
  } catch {
    throw new NextshipError(
      'The env loader returned output that is not JSON.',
      'This is a nextship defect. Please report it.'
    )
  }

  return new Map(Object.entries(parsed.variables ?? {}))
}

function resolveLoader(): string {
  const require = createRequire(import.meta.url)
  const here = path.dirname(fileURLToPath(import.meta.url))
  // Beside the compiled output in a published package, one level up from it in
  // this repository. Resolved rather than assumed so a layout change fails here
  // rather than at the point of use.
  for (const candidate of [
    path.join(here, '..', 'runtime', 'load-env.cjs'),
    path.join(here, '..', '..', 'runtime', 'load-env.cjs'),
  ]) {
    try {
      return require.resolve(candidate)
    } catch {
      continue
    }
  }
  throw new NextshipError(
    'The env loader script is missing from this nextship installation.',
    'Reinstall nextship. If you are running from a checkout, run `pnpm build` first.'
  )
}

// ------------------------------------------------------------------ writing

/**
 * Removes known secret values from a message.
 *
 * The update request carries plaintext secrets, and an API error is rendered
 * from the response body, so a validation message that quotes the offending
 * field would print a secret to the terminal and into whatever captured it.
 * Short values are skipped: replacing a one or two character value would redact
 * unrelated text and make the error unreadable without protecting anything
 * meaningful.
 */
export function redact(message: string, values: Iterable<string>): string {
  let result = message
  for (const value of values) {
    if (value.length < 4) continue
    result = result.split(value).join('[redacted]')
  }
  return result
}

// ----------------------------------------------------------------- commands

/** Lists the keys set on the app. Values are never printed, and secrets cannot be read back. */
export async function listEnv(project: ProjectInfo): Promise<void> {
  const app = await ownedApp(project)
  const envs = await app.target.env(app.appId)

  step(`Runtime environment for ${app.name}`)
  if (envs.length === 0) {
    detail('No environment variables are set on this app.')
    detail('Values inlined at build time, such as NEXT_PUBLIC_*, still work. Anything read')
    detail('at request time is undefined. Run `nextship env push` to set them.')
    ok('0 variable(s) set.')
    return
  }

  for (const entry of envs) {
    const readable = entry.secret ? 'secret, value not readable' : 'plain, readable'
    detail(`${entry.key}  ${readable}  on ${entry.location}`)
  }
  ok(`${envs.length} variable(s) set.`)
}

/** Uploads the project's env files as runtime variables. */
export async function pushEnv(project: ProjectInfo, options: EnvOptions): Promise<void> {
  const app = await ownedApp(project)

  if (project.envFiles.length === 0) {
    throw new NextshipError(
      'This project has no env files to push.',
      'nextship reads the same files Next.js does, in the same order. Create one, then run this again.'
    )
  }

  const values = await collectEnv(project)
  if (values.size === 0) {
    throw new NextshipError(
      `No variables were found in ${project.envFiles.join(', ')}.`,
      'Check that the files contain KEY=value lines.'
    )
  }

  const preview = await app.target.previewEnv(app.appId, values)
  const existing = await app.target.env(app.appId)
  const added = preview.filter((entry) => entry.action === 'add')
  const untouched = existing.filter((entry) => !values.has(entry.key))

  step('Plan')
  detail(`app        ${app.name} (${app.appId})`)
  detail(`source     ${project.envFiles.join(', ')}`)
  // Keys and classifications only. Printing a value would put a secret into a
  // terminal buffer and into whatever captures it.
  for (const entry of preview) {
    const action = entry.action === 'update' ? 'update' : 'add   '
    const stored = entry.secret ? 'encrypted, not readable afterwards' : 'readable, already public in the browser'
    detail(`${action}     ${entry.key}  ${stored}`)
  }
  detail(`untouched  ${untouched.length} variable(s) already on the app`)
  detail('nothing is removed; a variable this push does not name keeps its current value')

  warnAboutContent(values, added.length)

  if (!options.confirmed) {
    ok('This was a plan only. Nothing changed.')
    detail('Run `nextship env push --yes` to execute it.')
    return
  }

  step('Pushing')
  await writeEnvs(() => app.target.setEnv(app.appId, values), values.values())
  ok(`${values.size} variable(s) set on "${app.name}".`)
  detail('The target starts a new deployment so the new environment takes effect.')
}

/** Removes named variables from the app. */
export async function removeEnv(project: ProjectInfo, options: RemoveOptions): Promise<void> {
  const app = await ownedApp(project)

  if (options.keys.length === 0) {
    throw new NextshipError(
      'No variable was named.',
      'Run `nextship env rm KEY [KEY...]`. Every key must be named: there is no wildcard.'
    )
  }

  const existing = await app.target.env(app.appId)
  const present = new Set(existing.map((entry) => entry.key))

  const missing = options.keys.filter((key) => !present.has(key))
  if (missing.length > 0) {
    throw new NextshipError(
      `Not set on "${app.name}": ${missing.join(', ')}.`,
      'Run `nextship env` to see what is set. Nothing was changed.'
    )
  }

  const remaining = existing.length - options.keys.length

  step('Plan')
  detail(`app        ${app.name} (${app.appId})`)
  for (const key of options.keys) detail(`remove     ${key}`)
  detail(`keeping    ${remaining} other variable(s)`)
  // No count-based refusal here. Every key has to be typed out, there is no
  // wildcard, and removing the last variable is exactly what undoing a push
  // looks like. Refusing it would leave a mistaken push stranded on the app,
  // which is the problem this command exists to solve.
  if (remaining === 0) warn('This removes every variable currently set on the app.')
  warn('A secret cannot be read back, so its value is gone once removed. Have a copy before you continue.')

  if (!options.confirmed) {
    ok('This was a plan only. Nothing changed.')
    detail('Run the same command with --yes to execute it.')
    return
  }

  step('Removing')
  await writeEnvs(() => app.target.unsetEnv(app.appId, options.keys), [])
  ok(`${options.keys.length} variable(s) removed from "${app.name}".`)
  detail('The target starts a new deployment so the change takes effect.')
}

// ------------------------------------------------------------------ helpers

/**
 * Performs a write, rendering any failure with the pushed values removed.
 *
 * Any error is rendered with the pushed values removed, because the request body
 * held them in plaintext and an API validation message can quote the field it
 * rejected.
 */
async function writeEnvs(write: () => Promise<void>, secrets: Iterable<string>): Promise<void> {
  try {
    await write()
  } catch (error) {
    const values = [...secrets]
    if (error instanceof NextshipError) {
      throw new NextshipError(redact(error.message, values), redact(error.action, values))
    }
    throw new NextshipError(
      redact(error instanceof Error ? error.message : String(error), values),
      'Nothing was changed. Check the message above.'
    )
  }
}

/** Says what a push is about to do that the user probably did not intend. */
function warnAboutContent(values: Map<string, string>, addedCount: number): void {
  const critical = [...values.keys()].filter((key) => RUNTIME_CRITICAL.has(key))
  if (critical.length > 0) {
    warn(
      `${critical.join(', ')} change how the container runs and override what the image sets. ` +
        'A development value here will apply in production.'
    )
  }
  // Not the same as the warning above: this one is fatal rather than merely
  // wrong. The image ships only production runtimes, because development ones
  // are unreachable under NODE_ENV=production and cost 53 MB, so setting
  // NODE_ENV=development makes Next.js require a file that is not there.
  if (values.get('NODE_ENV') === 'development') {
    warn(
      'NODE_ENV=development will stop the container starting: the image contains only ' +
        'production runtimes, so Next.js would look for a development build that is not shipped.'
    )
  }

  const publicKeys = [...values.keys()].filter((key) => key.startsWith('NEXT_PUBLIC_'))
  if (publicKeys.length > 0) {
    warn(
      `${publicKeys.length} NEXT_PUBLIC_ variable(s) are compiled into the browser bundle at build time. ` +
        'Pushing them does not change what a browser already receives: that needs `nextship deploy`.'
    )
  }

  if (addedCount === 0) {
    warn(
      'Every variable in this push is already set. A stored secret is never returned, so nextship ' +
        'cannot tell whether any value actually differs, and this will restart the app either way.'
    )
  }

  warn('These values leave your machine and are stored in your DigitalOcean account.')
}
