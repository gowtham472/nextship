/**
 * @nextship/cli: preview deployments
 *
 * A preview is another app on the project's server, named `<app>-<preview>`, with its
 * own containers, env file and domains, and it answers only on the domains attached to
 * it. What makes it this project's is recorded on the server rather than in
 * `nextship.json`: its app record names the app it previews by id. A CI runner that
 * checks out the repository has the committed `nextship.json` and nothing else, so a
 * preview it deployed for one pull request has to be found again by the run that
 * closes that pull request, from the id both runs share.
 *
 * `--preview <name>` is taken off the command line before any command parses it, and
 * scopes the whole command to that preview. Only commands that act on one app take it.
 *
 * Author: Ragul D
 * Design: ../../../docs/design.md §9.3
 */

import { NextshipError } from './errors.js'

/** The commands that act on one app, and so can act on a preview instead. */
const PREVIEW_COMMANDS = ['deploy', 'rollback', 'logs', 'env', 'domain', 'images', 'destroy']

let selected: string | null = null

/**
 * Removes `--preview <name>` from a command's arguments and records it for the
 * command, refusing it where it has no meaning.
 */
export function takePreview(command: string, argv: string[]): string[] {
  const at = argv.indexOf('--preview')
  if (at === -1) return argv
  const name = argv[at + 1]
  if (!name || name.startsWith('--')) {
    throw new NextshipError('--preview needs a name.', 'For example `nextship deploy --preview pr-42`.')
  }
  if (!PREVIEW_COMMANDS.includes(command)) {
    throw new NextshipError(`\`nextship ${command}\` does not act on one app, so it takes no --preview.`, 'Drop --preview.')
  }
  selected = assertPreviewName(name)
  return [...argv.slice(0, at), ...argv.slice(at + 2)]
}

/** The preview this command acts on, or null for the project's own app. */
export function selectedPreview(): string | null {
  return selected
}

/**
 * A preview name becomes part of an app name, a container name and a hostname a user
 * may give it, so it is held to what all three accept.
 */
export function assertPreviewName(name: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(name)) {
    throw new NextshipError(
      `"${name}" is not a preview name.`,
      'Use lowercase letters, digits and hyphens, up to 32 characters, starting and ending with a letter or digit, such as pr-42.'
    )
  }
  return name
}

export function previewAppName(appName: string, preview: string): string {
  return `${appName}-${assertPreviewName(preview)}`
}
