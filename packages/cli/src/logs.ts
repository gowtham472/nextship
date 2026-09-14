/**
 * @nextship/cli: runtime logs
 *
 * Two shapes, because App Platform offers two and they answer different
 * questions. A snapshot prints what the running container has buffered and
 * exits, which is what you want when something already happened. Following
 * streams new output as it arrives, which is what you want while reproducing
 * something.
 *
 * Neither is history. The platform buffers only the container running right
 * now, so a deployment that has been replaced takes its output with it. Saying
 * that plainly matters: an empty result usually means the logs aged out or the
 * container restarted, not that the app printed nothing, and guessing wrong
 * sends people hunting a bug that is not there.
 *
 * How output is streamed is the driver's: App Platform hands out a websocket URL
 * that carries its own access token.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §10.7
 */

import type { ProjectInfo } from './detect.js'
import { ownedApp } from './owned-app.js'
import type { Target } from './targets/target.js'
import { detail, ok, step } from './util/log.js'

export interface LogOptions {
  /** Stream new output instead of printing what is buffered and exiting. */
  follow: boolean
}

export async function logs(project: ProjectInfo, options: LogOptions): Promise<void> {
  const app = await ownedApp(project)
  step(`Runtime logs for ${app.name}`)

  if (options.follow) return follow(app.target, app.appId)

  const text = await app.target.readLogs(app.appId)
  if (!text.trim()) {
    detail('The running container has no buffered output.')
    detail('The platform keeps only the current container recent logs, so output from a')
    detail('replaced deployment is already gone.')
    return
  }
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

/**
 * Streams until the user stops it or the target ends the stream.
 *
 * Ctrl+C aborts the stream rather than letting the process die under it, so the
 * command reports a stop as a stop, and a stream the target ended is reported
 * rather than left to look like the app went quiet.
 */
async function follow(target: Target, appId: string): Promise<void> {
  detail('following, press Ctrl+C to stop')

  const controller = new AbortController()
  const stop = (): void => controller.abort()
  process.on('SIGINT', stop)

  let ended: string | null
  try {
    ended = await target.followLogs(appId, (text) => process.stdout.write(text), controller.signal)
  } finally {
    process.off('SIGINT', stop)
  }

  if (ended === null) ok('Stopped')
  else detail(ended)
}
