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
 * The stream URL carries its own access token, so it is treated as a secret
 * throughout: never printed, never logged, never put in an error message.
 *
 * Author: Gowtham
 * Design: ../../../docs/00-design.md §10.7
 */

import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { ownedApp } from './owned-app.js'
import type { Target } from './targets/target.js'
import { detail, ok, step } from './util/log.js'

/** How long to wait for the server to answer a close before finishing anyway. */
const CLOSE_GRACE_MS = 2000

export interface LogOptions {
  /** Stream new output instead of printing what is buffered and exiting. */
  follow: boolean
}

/** One frame of the log stream. Anything else is ignored rather than printed raw. */
interface LogFrame {
  op?: string
  data?: string
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
 * Streams until the user stops it or the server closes the connection.
 *
 * The socket is closed on Ctrl+C rather than letting the process die under it,
 * so the command reports a stop as a stop. The server also ends the stream on
 * its own, because these URLs expire, and that is reported rather than left to
 * look like the app went quiet.
 */
async function follow(target: Target, appId: string): Promise<void> {
  const url = await target.logStreamUrl(appId)
  if (!url) {
    throw new NextshipError(
      'The target returned no log stream for this app.',
      'It may have no running container yet. Try `nextship logs` without --follow.'
    )
  }

  detail('following, press Ctrl+C to stop')

  const socket = new WebSocket(url.replace(/^http/, 'ws'))
  let stopping = false
  let stop = (): void => {
    stopping = true
  }

  process.on('SIGINT', () => stop())

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }

      stop = (): void => {
        stopping = true
        // 1000 is a normal closure, which tells the server this was deliberate
        // rather than a dropped connection.
        try {
          socket.close(1000)
        } catch {
          // Already closing or closed, so there is nothing left to ask for.
        }
        // Registering a SIGINT handler stops Node exiting on Ctrl+C, so if the
        // server never completes the close handshake the command would hang
        // with no way out but killing it. Measured: a close request that was
        // never answered left the process running indefinitely. The timer is
        // unref'd so it never keeps the process alive on its own.
        setTimeout(finish, CLOSE_GRACE_MS).unref()
      }

      socket.onmessage = (event) => process.stdout.write(frameText(event.data))
      socket.onclose = finish
      socket.onerror = () => {
        if (settled) return
        // The event carries no useful detail, and anything it did carry could
        // include the tokenised URL, so the message is written here instead.
        if (stopping) finish()
        else {
          settled = true
          reject(
            new NextshipError(
              'The log stream closed unexpectedly.',
              'The stream URL is short-lived. Run the command again to reconnect.'
            )
          )
        }
      }
    })
  } finally {
    process.removeAllListeners('SIGINT')
  }

  if (stopping) ok('Stopped')
  else detail('The stream ended. These URLs are short-lived; run the command again to reconnect.')
}

/**
 * Turns one frame into text.
 *
 * Frames are JSON objects carrying the line in `data`. A frame that is not JSON
 * is printed as it arrived rather than dropped, because losing output is worse
 * than printing something unexpected, but it is never parsed for meaning.
 */
export function frameText(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : String(raw)

  let frame: LogFrame
  try {
    frame = JSON.parse(text) as LogFrame
  } catch {
    return text.endsWith('\n') ? text : `${text}\n`
  }

  if (typeof frame.data !== 'string') return ''
  return frame.data.endsWith('\n') ? frame.data : `${frame.data}\n`
}
