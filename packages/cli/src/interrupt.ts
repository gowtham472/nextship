/**
 * @nextship/cli: stopping a release from outside
 *
 * A release on a server holds the app's deploy lock, and nothing breaks that lock
 * automatically. A release that is stopped therefore has to be told, so it can put
 * things back and let the lock go, rather than be killed where it stands. Ctrl+C
 * was handled that way from the start. Closing the terminal was not: that arrives
 * as SIGHUP, which ends a process that does not listen for it, and it left the app
 * locked until a person removed the lock by hand. `kill`, and a CI runner
 * cancelling a job, arrive as SIGTERM and did the same.
 *
 * All of them now abort one signal the release watches. Listeners are attached
 * before the release starts, not after, so a stop that arrives while the lock is
 * being taken is remembered and acted on once the release can be given back.
 *
 * Author: Gowtham
 */

/**
 * SIGBREAK is Ctrl+Break on Windows, where it is the one of these besides Ctrl+C
 * a console can send. Windows delivers a closed console as SIGHUP and ends the
 * process about ten seconds later whatever it is doing, which is long enough to
 * release a lock and not long enough to finish a deployment.
 */
export const STOP_SIGNALS: NodeJS.Signals[] =
  process.platform === 'win32' ? ['SIGINT', 'SIGHUP', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGHUP', 'SIGTERM']

/**
 * Runs `work` with a signal that aborts when the process is asked to stop, and
 * leaves the process's signal handling as it found it.
 */
export async function untilStopped<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const stopping = new AbortController()
  const stop = (): void => {
    // After a hangup the terminal is gone, and a write to it fails with an error
    // event nobody is listening for, which would end the process before the
    // release had been given back. The output has no reader left to miss it.
    process.stdout.on('error', ignore)
    process.stderr.on('error', ignore)
    stopping.abort()
  }
  for (const name of STOP_SIGNALS) process.on(name, stop)
  try {
    return await work(stopping.signal)
  } finally {
    for (const name of STOP_SIGNALS) process.off(name, stop)
    process.stdout.off('error', ignore)
    process.stderr.off('error', ignore)
  }
}

function ignore(): void {}
