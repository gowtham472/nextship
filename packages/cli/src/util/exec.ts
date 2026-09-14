/**
 * @nextship/cli: subprocess execution
 *
 * Two shapes are needed and no more: `run` streams a long build to the user's
 * terminal, `capture` reads short output from a probe that is allowed to fail.
 *
 * cross-spawn resolves Windows shims (`npm.cmd`, `docker.exe` on PATH) without
 * `shell: true`, which Node deprecates because arguments are concatenated into a
 * shell string rather than passed to the process. That deprecation printed a
 * warning to users on every build before this was fixed.
 *
 * Author: Gowtham
 * Rules: ../../../../AGENTS.md §4.2
 */

import spawn from 'cross-spawn'
import { NextshipError } from '../errors.js'

/** A command that ran and exited non-zero. `exitCode` lets callers treat a user-initiated stop as success. */
export class CommandError extends NextshipError {
  readonly exitCode: number

  constructor(printable: string, exitCode: number) {
    super(
      `\`${printable}\` exited with code ${exitCode}.`,
      'Fix the error printed above, then run the same nextship command again.'
    )
    this.name = 'CommandError'
    this.exitCode = exitCode
  }
}

/**
 * Runs a command with its output streamed straight through, and throws
 * `CommandError` if it exits non-zero. Used for builds, where the user needs to
 * see progress live.
 */
export async function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): Promise<void> {
  const printable = [command, ...args].join(' ')

  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    })
    child.on('error', (error) => reject(describeSpawnFailure(command, error)))
    child.on('close', (exitCode, signal) => resolve(exitCode ?? signalExitCode(signal)))
  })

  if (code !== 0) throw new CommandError(printable, code)
}

/**
 * Runs a command and returns its trimmed stdout, or null if it cannot run or
 * exits non-zero. Used only for optional probes, where absence is a valid answer.
 */
export async function capture(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code === 0 ? stdout.trim() : null))
  })
}

/**
 * Runs a command, returns its stdout, and throws with the child's stderr when it
 * fails.
 *
 * `capture` above is for probes where absence is a valid answer, so it reports a
 * failure as `null` and throws stderr away. That is the wrong shape for reading
 * values the deployment depends on: a loader that cannot run must say why, not
 * quietly report that the project has no variables.
 *
 * `env` replaces the child's environment rather than extending it, which is what
 * `run` does. Callers that read untrusted input need to hand the child a minimal
 * environment, and inheriting by default would defeat that.
 */
export async function captureStrict(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<string> {
  const printable = [command, ...args].join(' ')

  const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let out = ''
      let err = ''
      child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()))
      child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString()))
      child.on('error', (error) => reject(describeSpawnFailure(command, error)))
      child.on('close', (exitCode, signal) =>
        resolve({ code: exitCode ?? signalExitCode(signal), stdout: out, stderr: err })
      )
    }
  )

  if (code !== 0) {
    throw new NextshipError(
      `\`${printable}\` exited with code ${code}: ${stderr.trim() || 'no output'}`,
      'Check the error above.'
    )
  }
  return stdout
}

function describeSpawnFailure(command: string, error: NodeJS.ErrnoException): NextshipError {
  if (error.code === 'ENOENT') {
    return new NextshipError(
      `\`${command}\` is not installed or not on PATH.`,
      `Install ${command}, make sure it is on PATH, then run the command again.`
    )
  }
  return new NextshipError(`Could not start \`${command}\`: ${error.message}`, 'Check the error above.')
}

/**
 * A child killed by a signal has no exit code. 128 plus the signal number is the
 * convention shells use, so Ctrl+C surfaces as 130 and can be recognised.
 */
function signalExitCode(signal: NodeJS.Signals | null): number {
  const numbers: Partial<Record<NodeJS.Signals, number>> = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9, SIGHUP: 1 }
  return 128 + (signal ? (numbers[signal] ?? 0) : 0)
}

/**
 * Runs `a | b` without a shell, and throws if either side fails.
 *
 * Used to stream an image into a server with `docker save | ssh docker load`.
 * A shell pipeline reports only the last command's status by default, so a
 * `docker save` that died half way through would look like a successful load of
 * a truncated image. Both exit codes are checked here, and the side that failed
 * is the one named.
 *
 * When `b` exits early, `a` is writing into a closed pipe; that EPIPE is
 * expected and is reported as `b`'s failure, which is the cause. A side killed
 * by a signal, such as Ctrl+C reaching the whole process group, surfaces as
 * 128 plus the signal number, the same as `run`.
 */
export async function pipeline(
  a: [string, string[]],
  b: [string, string[]],
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): Promise<void> {
  const env = { ...process.env, ...options.env }
  const first = spawn(a[0], a[1], { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const second = spawn(b[0], b[1], { cwd: options.cwd, env, stdio: ['pipe', 'inherit', 'pipe'] })

  const collect = (child: ReturnType<typeof spawn>, other: ReturnType<typeof spawn>): Promise<{ code: number; stderr: string }> =>
    new Promise((resolve, reject) => {
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
      child.on('error', (error: NodeJS.ErrnoException) => {
        // The other side would otherwise wait forever on a pipe nobody feeds or reads.
        other.kill()
        reject(describeSpawnFailure(String(child.spawnfile), error))
      })
      child.on('close', (exitCode, signal) => resolve({ code: exitCode ?? signalExitCode(signal), stderr }))
    })

  // A closed pipe on either end is a consequence of the other side exiting, and
  // that side's own exit code carries the real cause.
  first.stdout?.on('error', () => {})
  second.stdin?.on('error', () => {})
  first.stdout?.pipe(second.stdin as NodeJS.WritableStream)
  // Once the receiver is gone nothing reads the sender's output, and a sender
  // blocked on a full pipe never exits. Closing our end gives it EPIPE instead.
  second.on('close', () => first.stdout?.destroy())

  const [left, right] = await Promise.all([collect(first, second), collect(second, first)])

  const describe = (side: [string, string[]], outcome: { code: number; stderr: string }) =>
    `\`${[side[0], ...side[1]].join(' ')}\` exited with code ${outcome.code}: ${outcome.stderr.trim() || 'no output'}`

  if (right.code !== 0) throw new NextshipError(describe(b, right), 'Check the error above. Nothing was changed on the receiving side.')
  if (left.code !== 0) throw new NextshipError(describe(a, left), 'Check the error above. The receiving side may hold a partial result, which the next attempt replaces.')
}
