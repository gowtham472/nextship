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
  options: { cwd: string }
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
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
