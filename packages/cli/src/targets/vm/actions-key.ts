/**
 * @nextship/cli: the Server Actions key for an app on a server
 *
 * Next.js encrypts Server Action payloads with one key, and a client holding a
 * page built with one key cannot call actions on a build made with another. On
 * App Platform nextship keeps the key in `.nextship/secrets.local.json`, which is
 * not committed, so a second machine or a CI runner generates a different one and
 * breaks every open page. A server is a place both machines already reach, so for
 * a VM project the key lives there instead: `/etc/nextship/apps/<name>/secrets`,
 * mode 0600, and every machine that deploys reads the same one.
 *
 * The decision is a pure function so every combination is tested. The rule that
 * shapes it is the one `build.ts` already follows: a key is never rotated
 * silently. Where the server and this machine disagree, nextship refuses and
 * says so, because either choice would break someone's open pages.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { NextshipError } from '../../errors.js'

export const KEY_ENV = 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'

export interface KeyInputs {
  /** `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` in this process's environment. */
  environment: string | undefined
  /** The key stored on the server, or null when it has none. */
  server: string | null
  /** The key in `.nextship/secrets.local.json`, or null when there is no file. */
  local: string | null
}

export type KeyDecision =
  /** Use this key. `warning` is printed when it overrides a different stored one. */
  | { action: 'use'; key: string; source: 'environment' | 'server'; warning: string | null }
  /** Upload the local key, so the server holds the one this machine already built with. */
  | { action: 'upload'; key: string }
  /** Nobody has a key yet: store this new one on the server only. */
  | { action: 'generate' }

export function decideKey(inputs: KeyInputs): KeyDecision {
  if (inputs.environment) {
    const differs = inputs.server !== null && inputs.server !== inputs.environment
    return {
      action: 'use',
      key: inputs.environment,
      source: 'environment',
      warning: differs
        ? `${KEY_ENV} differs from the key stored on the server. Using the environment variable; clients on builds made with the server's key will fail Server Actions.`
        : null,
    }
  }

  if (inputs.server !== null && inputs.local !== null && inputs.server !== inputs.local) {
    throw new NextshipError(
      'The Server Actions key on the server differs from the one in .nextship/secrets.local.json.',
      'nextship will not choose one, because either choice breaks Server Actions for some open pages. ' +
        `Decide which key your live deployment was built with, then delete the local file to use the server's key, or set ${KEY_ENV} to the one you want.`
    )
  }

  if (inputs.server !== null) return { action: 'use', key: inputs.server, source: 'server', warning: null }
  if (inputs.local !== null) return { action: 'upload', key: inputs.local }
  return { action: 'generate' }
}
