/**
 * @nextship/cli: the env file on a server
 *
 * A VM app's runtime variables live in `/etc/nextship/apps/<name>/env`, which
 * Docker reads with `--env-file` when it starts the container. That format is
 * Docker's, not dotenv's, and the difference matters: every line is `KEY=value`
 * taken literally, quotes included, with no escapes and no way to continue a
 * value onto a second line. So values are checked before they are written,
 * rather than written in a form Docker would silently read differently.
 *
 * The project's own env files are still read by `@next/env`, exactly as
 * `env.ts` does for every target. This module only reads and writes the file
 * nextship itself produced.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { NextshipError } from '../../errors.js'
import { assertEnvKey } from './ssh.js'

/** Reads a file this module wrote. Lines that are not `KEY=value` are refused rather than skipped. */
export function parseEnvFile(contents: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const [index, line] of contents.split('\n').entries()) {
    if (line === '') continue
    const separator = line.indexOf('=')
    if (separator < 1) {
      throw new NextshipError(
        `Line ${index + 1} of the env file on the server is not KEY=value.`,
        'nextship writes that file itself. Fix the line on the server, or remove the file and run `nextship env push` again.'
      )
    }
    values.set(line.slice(0, separator), line.slice(separator + 1))
  }
  return values
}

/**
 * Writes variables in Docker's env file format, refusing what that format cannot
 * carry. A value with a newline would become a second, unrelated line; Docker
 * reads a NUL as the end of the value.
 */
export function renderEnvFile(values: Map<string, string>): string {
  const lines: string[] = []
  for (const [key, value] of values) {
    assertEnvKey(key)
    if (/[\n\r\0]/.test(value)) {
      throw new NextshipError(
        `${key} contains a line break, which a server's env file cannot hold.`,
        'Docker reads the env file one line per variable. Encode the value, for example as base64, and decode it in the app. Nothing was changed.'
      )
    }
    lines.push(`${key}=${value}`)
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}
