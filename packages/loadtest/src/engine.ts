/**
 * nextship-loadtest: finding and running k6
 *
 * k6 does the load generation and the measuring. This finds a k6 to run, the one
 * on PATH if there is one and the official Docker image otherwise, so the command
 * works on a machine that has only Docker, which every nextship user already has.
 * The script goes in on stdin and the summary comes back on stdout, so nothing is
 * written to disk on either side.
 *
 * A container has its own loopback address, so a target on this machine needs
 * help to be reached from one. On Linux the container shares the host's network.
 * Docker Desktop has no host network to share, and gives the host the name
 * `host.docker.internal` instead, so the target is rewritten to that name there.
 *
 * Author: Gowtham
 */

import { spawn } from 'node:child_process'
import { LoadtestError } from './errors.js'

/** The k6 release the generated script and the report were written against. */
export const K6_IMAGE = 'grafana/k6:2.3.0'

export type Engine = { kind: 'local'; version: string } | { kind: 'docker' }

export interface Invocation {
  command: string
  args: string[]
  /** The target as k6 requests it, which differs from the one typed when it was rewritten. */
  target: string
}

/** The k6 on PATH, else Docker with a running daemon, else a failure that says how to get either. */
export async function findEngine(): Promise<Engine> {
  const local = await probe('k6', ['version'])
  const version = local === null ? null : /v(\d+\.\d+\.\d+)/.exec(local)
  if (version) return { kind: 'local', version: version[1] }

  // The server version, not the client's: a Docker CLI with no daemon cannot run anything.
  if ((await probe('docker', ['version', '--format', '{{.Server.Version}}'])) !== null) return { kind: 'docker' }

  throw new LoadtestError(
    'Neither k6 nor a running Docker was found, and the test needs one of them.',
    'Start Docker, or install k6 from https://grafana.com/docs/k6/latest/set-up/install-k6/, then run the same command again.'
  )
}

export function describeEngine(engine: Engine): string {
  return engine.kind === 'local'
    ? `k6 ${engine.version}, installed on this machine`
    : `k6 in Docker (${K6_IMAGE}), pulled on first use`
}

export function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || /^127\./.test(hostname) || hostname === '[::1]'
}

/** The exact command for a test, kept apart from running it so the choices above can be tested. */
export function invocation(engine: Engine, url: string, platform: NodeJS.Platform): Invocation {
  const k6 = (target: string): string[] => ['run', '--quiet', '-e', `TARGET=${target}`, '-']
  if (engine.kind === 'local') return { command: 'k6', args: k6(url), target: url }

  const parsed = new URL(url)
  if (!isLoopback(parsed.hostname)) return { command: 'docker', args: ['run', '--rm', '-i', K6_IMAGE, ...k6(url)], target: url }

  if (platform === 'linux') {
    return { command: 'docker', args: ['run', '--rm', '-i', '--network', 'host', K6_IMAGE, ...k6(url)], target: url }
  }
  parsed.hostname = 'host.docker.internal'
  return { command: 'docker', args: ['run', '--rm', '-i', K6_IMAGE, ...k6(parsed.href)], target: parsed.href }
}

/** How much of k6's stderr is kept: a failing target makes k6 warn once per request. */
const STDERR_KEPT = 2000

/** Runs the script and returns what k6 wrote to stdout, which is the JSON summary. */
export async function runK6(run: Invocation, script: string): Promise<string> {
  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(run.command, run.args, { stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
      child.stderr.on('data', (chunk: Buffer) => (err = (err + chunk.toString()).slice(-STDERR_KEPT)))
      child.on('error', (error) =>
        reject(new LoadtestError(`Could not start \`${run.command}\`: ${error.message}`, 'Check the error above.'))
      )
      child.on('close', (exitCode) => resolve({ code: exitCode, stdout: out, stderr: err }))
      // k6 that exits before reading the script closes the pipe; its exit code says why.
      child.stdin.on('error', () => {})
      child.stdin.end(script)
    }
  )

  if (code !== 0) {
    throw new LoadtestError(
      `\`${run.command}\` ${code === null ? 'was stopped before the test finished' : `exited with code ${code}`}: ${stderr.trim() || 'no output'}`,
      'Check the error above. No result was produced, so nothing is reported.'
    )
  }
  return stdout
}

/** Trimmed stdout of a command that answers a question, or null when it cannot run or fails. */
async function probe(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code === 0 ? stdout.trim() : null))
  })
}
