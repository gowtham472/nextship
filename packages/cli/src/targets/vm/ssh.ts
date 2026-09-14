/**
 * @nextship/cli: SSH to a server
 *
 * Every byte the VM target sends to a server goes through here, so this is where
 * the security posture of that target is decided, and it is decided narrowly.
 *
 * It wraps the system `ssh` binary rather than a Node SSH library. The user's
 * keys, agent, `~/.ssh/config` and hardware tokens already work with it, and a
 * library would mean nextship reading private keys itself. It is spawned through
 * cross-spawn and never with `shell: true`, so nothing on this machine ever
 * interprets a command string.
 *
 * The remote side is a shell, and that cannot be avoided: OpenSSH hands the
 * command to the login shell as one string. So every value placed in a remote
 * command is either validated against a strict pattern or quoted with
 * `shellQuote`, and anything secret is sent on stdin instead, where it cannot
 * appear in a process listing on either machine.
 *
 * Connections pin the host key. `nextship.json` holds the key `server add`
 * recorded; it is written to a private known_hosts file under an alias, and
 * `StrictHostKeyChecking=yes` makes a changed key a hard failure. Batch mode and
 * no password authentication mean a missing key fails at once instead of
 * waiting at a prompt nobody is watching.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import spawn from 'cross-spawn'
import { NextshipError } from '../../errors.js'
import { hostKeyAlgorithms, knownHostsLine, parseKeyLine } from './host-key.js'

/** The name every connection gives the host in its known_hosts file. */
const HOST_ALIAS = 'nextship-server'

export interface SshEndpoint {
  host: string
  port: number
  user: string
  /** The pinned key line from `nextship.json`. */
  hostKey: string
}

export interface SshResult {
  code: number
  stdout: string
  stderr: string
}

// ------------------------------------------------------------------ quoting

/**
 * Quotes a value for a POSIX shell. Single quotes take everything literally,
 * and a single quote inside is closed, escaped and reopened.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const refuse = (what: string, value: string, rule: string): never => {
  throw new NextshipError(`"${value}" is not a valid ${what}.`, rule)
}

/** App names become container names, directory names and Caddy site files. */
export function assertAppName(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(value)) {
    refuse('app name', value, 'Use up to 63 lowercase letters, digits, dots, hyphens and underscores, starting with a letter or digit.')
  }
  return value
}

/** Deployment ids become image tags and container name suffixes, which Docker limits to this. */
export function assertDeploymentId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    refuse('deployment id', value, 'Use letters, digits, dots, hyphens and underscores, up to 128 characters.')
  }
  return value
}

export function assertEnvKey(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    refuse('environment variable name', value, 'Use letters, digits and underscores, not starting with a digit.')
  }
  return value
}

export function assertDomain(value: string): string {
  if (!/^(?=.{4,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(value)) {
    refuse('domain', value, 'Use lowercase letters, digits, hyphens and dots, for example app.example.com.')
  }
  return value
}

/**
 * A hostname, IPv4 or IPv6 address. It is an argument to ssh rather than part of
 * a remote command, but one starting with a hyphen would be read as an option.
 */
export function assertHost(value: string): string {
  const hostname = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/
  const ipv6 = /^[0-9A-Fa-f:]{2,39}$/
  if (!hostname.test(value) && !(value.includes(':') && ipv6.test(value))) {
    refuse('host', value, 'Use a hostname or an IP address, for example 203.0.113.10.')
  }
  return value
}

export function assertUser(value: string): string {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(value)) {
    refuse('user name', value, 'Use a Linux user name: lowercase letters, digits, hyphens and underscores.')
  }
  return value
}

// --------------------------------------------------------------- failures

/**
 * Turns ssh's own failures into something to act on.
 *
 * Exit 255 is ssh's code for its own errors, but a remote command can also exit
 * 255, so the decision is made on stderr: only text OpenSSH itself prints is
 * mapped, and anything else is left as the remote command's result.
 */
export function connectionFailure(endpoint: { host: string; port: number; user: string }, result: SshResult): NextshipError | null {
  if (result.code !== 255) return null
  const where = `${endpoint.user}@${endpoint.host}:${endpoint.port}`
  const stderr = result.stderr

  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key .* differs/i.test(stderr)) {
    return new NextshipError(
      `The host key of ${endpoint.host} does not match the one recorded in nextship.json. Nothing was sent to it.`,
      'This is what a server impersonating yours looks like, and also what a rebuilt server looks like. ' +
        "Confirm the server's new SHA256 fingerprint through your provider's console, not over this connection. " +
        'Only then remove "server" from nextship.json and run `nextship server add` again, which shows the new fingerprint before trusting it.'
    )
  }
  if (/Permission denied|Too many authentication failures|no mutual signature/i.test(stderr)) {
    return new NextshipError(
      `${where} refused every key this machine offered.`,
      'Check that your SSH key is loaded (`ssh-add -l`) or configured for this host in ~/.ssh/config, ' +
        `and that \`ssh -p ${endpoint.port} ${endpoint.user}@${endpoint.host}\` works on its own.`
    )
  }
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(stderr)) {
    return new NextshipError(`${endpoint.host} does not resolve.`, 'Check the hostname, or use the server\'s IP address.')
  }
  if (/Connection refused|Connection timed out|Operation timed out|No route to host|Network is unreachable|Connection closed by|Connection reset/i.test(stderr)) {
    return new NextshipError(
      `Could not reach ${where}.`,
      `Check that the server is running, that SSH listens on port ${endpoint.port}, and that a firewall allows it.`
    )
  }
  if (/^ssh: |^kex_exchange_identification|^Bad /m.test(stderr)) {
    return new NextshipError(`ssh could not connect to ${where}: ${stderr.trim().split('\n').pop()}`, 'Check the message above.')
  }
  return null
}

// ------------------------------------------------------------- connection

export class Ssh {
  private constructor(
    readonly endpoint: SshEndpoint,
    /** A private directory holding the pinned known_hosts file and the control socket. */
    private readonly dir: string,
    private readonly algorithms: string
  ) {}

  /**
   * Prepares a connection. Nothing is sent until the first command: the control
   * master starts with it and later commands reuse it, so a deployment opens one
   * TCP connection rather than one per step.
   */
  static async open(endpoint: SshEndpoint): Promise<Ssh> {
    assertHost(endpoint.host)
    assertUser(endpoint.user)
    const key = parseKeyLine(endpoint.hostKey)
    if (!key) {
      throw new NextshipError(
        'The host key recorded in nextship.json is not a key line nextship can read.',
        'Restore nextship.json from version control, or remove "server" and run `nextship server add` again.'
      )
    }

    // The control socket path has to fit a Unix socket's 104 byte limit, and
    // macOS's per-user temporary directory is already about 50 bytes before
    // OpenSSH appends a 40 character connection hash. /tmp is short everywhere
    // but Windows, and the directory is created 0700 so nobody else can use it.
    const base = process.platform === 'win32' ? tmpdir() : '/tmp'
    const dir = await mkdtemp(path.join(base, 'nextship-ssh-'))
    await writeFile(path.join(dir, 'known_hosts'), knownHostsLine(HOST_ALIAS, key), { mode: 0o600 })
    return new Ssh(endpoint, dir, hostKeyAlgorithms(key))
  }

  /**
   * The options every ssh process for this server uses, so no call can forget
   * the pinned key. `multiplex: false` is for a long-lived forward, which has to
   * own its connection: handed to a control master it would exit at once.
   */
  options(settings: { multiplex: boolean } = { multiplex: true }): string[] {
    const options = [
      '-o', 'BatchMode=yes',
      '-o', 'PasswordAuthentication=no',
      '-o', 'KbdInteractiveAuthentication=no',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${path.join(this.dir, 'known_hosts')}`,
      '-o', 'GlobalKnownHostsFile=none',
      '-o', `HostKeyAlias=${HOST_ALIAS}`,
      '-o', `HostKeyAlgorithms=${this.algorithms}`,
      '-o', 'CheckHostIP=no',
      '-o', 'ConnectTimeout=15',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=4',
      '-o', 'LogLevel=ERROR',
      '-p', String(this.endpoint.port),
    ]
    // Windows' OpenSSH has no connection multiplexing, so each command opens its own.
    if (!settings.multiplex) {
      options.push('-o', 'ControlMaster=no', '-o', 'ControlPath=none')
    } else if (process.platform !== 'win32') {
      options.push('-o', 'ControlMaster=auto', '-o', `ControlPath=${path.join(this.dir, '%C')}`, '-o', 'ControlPersist=60')
    }
    return options
  }

  /** The private directory this connection owns, for sockets that must not be reachable by other users. */
  privateDir(): string {
    return this.dir
  }

  /** The destination, after `--` so nothing in it can be read as an option. */
  destination(): string[] {
    return ['--', `${this.endpoint.user}@${this.endpoint.host}`]
  }

  /**
   * Runs a remote command and returns its result, whatever its exit code.
   * ssh's own failures (unreachable, key refused, host key changed) throw.
   */
  async exec(command: string, options: { stdin?: string } = {}): Promise<SshResult> {
    const result = await new Promise<SshResult>((resolve, reject) => {
      const child = spawn('ssh', [...this.options(), ...this.destination(), command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
      child.on('error', (error: NodeJS.ErrnoException) =>
        reject(
          error.code === 'ENOENT'
            ? new NextshipError('`ssh` is not installed or not on PATH.', 'Install OpenSSH, then run the command again.')
            : error
        )
      )
      child.on('close', (code) => resolve({ code: code ?? 255, stdout, stderr }))
      // A server that closes the session before reading stdin would otherwise
      // surface as an unhandled EPIPE rather than as the command's exit code.
      child.stdin?.on('error', () => {})
      child.stdin?.end(options.stdin ?? '')
    })

    const failure = connectionFailure(this.endpoint, result)
    if (failure) throw failure
    return result
  }

  /** Runs a remote command that has to succeed, returning its stdout. */
  async run(command: string, what: string, options: { stdin?: string } = {}): Promise<string> {
    const result = await this.exec(command, options)
    if (result.code !== 0) {
      throw new NextshipError(
        `Could not ${what} on ${this.endpoint.host}: ${result.stderr.trim() || `exit code ${result.code}`}`,
        'Check the message above. Nothing after this step was attempted.'
      )
    }
    return result.stdout
  }

  /**
   * Streams a remote command's output until it ends or `signal` aborts, and
   * returns its exit code. Used for logs, where output arrives for as long as
   * the user watches.
   */
  async stream(command: string, write: (text: string) => void, signal: AbortSignal): Promise<number> {
    const result = await new Promise<SshResult>((resolve, reject) => {
      // -T: no terminal, so the remote command gets no SIGHUP handling surprises
      // and binary-safe output, and ending ssh ends the remote command with it.
      const child = spawn('ssh', ['-T', ...this.options(), ...this.destination(), command], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => write(chunk.toString()))
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderr += text
        write(text)
      })
      const stop = (): void => {
        child.kill('SIGTERM')
      }
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
      child.on('error', reject)
      child.on('close', (code) => {
        signal.removeEventListener('abort', stop)
        resolve({ code: code ?? 130, stdout: '', stderr })
      })
    })

    if (signal.aborted) return result.code
    const failure = connectionFailure(this.endpoint, result)
    if (failure) throw failure
    return result.code
  }

  /** Ends the shared connection and removes the pinned known_hosts file. */
  async close(): Promise<void> {
    if (process.platform !== 'win32') {
      await new Promise<void>((resolve) => {
        const child = spawn('ssh', [...this.options(), '-O', 'exit', ...this.destination()], { stdio: 'ignore' })
        child.on('error', () => resolve())
        child.on('close', () => resolve())
      })
    }
    await rm(this.dir, { recursive: true, force: true })
  }
}
