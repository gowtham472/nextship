/**
 * @nextship/cli: one more build when the builder's connection dropped
 *
 * A build on a server runs through an SSH forward of that server's Docker socket. On a
 * fresh DigitalOcean Droplet, seconds after `server add` had restarted Docker and SSH,
 * a build's session with the daemon dropped: the daemon logged its session health check
 * as failed, cancelled the build, and the client printed `error reading from server:
 * EOF`. The same deploy run again a minute later succeeded, and so did a second fresh
 * server. A build that failed for that reason is built once more over a new connection.
 *
 * A build that failed for any other reason, a compile error above all, is not retried:
 * running it twice would only double the wait before the same error. Only the builder
 * can tell the two apart, by asking the daemon, so a builder that cannot ask never
 * retries.
 *
 * Author: Gowtham
 */

import type { ImageBuilder } from './targets/target.js'
import { CommandError } from './util/exec.js'

export const RECONNECT_NOTICE =
  "The connection to the server's Docker dropped during the build: its daemon logged the build " +
  'session as lost, so this is not a fault in the app. Building once more over a new connection.'

/**
 * Runs `attempt` with a builder from `open`, and once more with a fresh builder if the
 * first attempt failed because the builder lost its connection. Every builder opened is
 * closed, whatever happens.
 */
export async function buildWithReconnect<T>(
  open: () => Promise<ImageBuilder>,
  attempt: (builder: ImageBuilder) => Promise<T>,
  onRetry: (notice: string) => void
): Promise<T> {
  const first = await open()
  try {
    return await attempt(first)
  } catch (error) {
    if (!(error instanceof CommandError) || !first.lostConnection || !(await first.lostConnection())) throw error
  } finally {
    await first.close()
  }

  onRetry(RECONNECT_NOTICE)
  const second = await open()
  try {
    return await attempt(second)
  } finally {
    await second.close()
  }
}
