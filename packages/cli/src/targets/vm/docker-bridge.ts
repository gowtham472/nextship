/**
 * @nextship/cli: a private local address for a server's Docker
 *
 * A remote build needs the Docker client on this machine to reach the daemon on
 * the server. Elsewhere that is an SSH forward to a Unix socket in a directory only
 * this user can enter. Windows' OpenSSH cannot forward to a Unix socket, and the
 * first answer was a loopback TCP port, which nothing authenticates: for as long as
 * a build ran, any process on the machine could drive the server's Docker, which is
 * root on the server, and so could a web page open in a browser, by rebinding a
 * name to 127.0.0.1.
 *
 * This listens on a local address a browser cannot open, a named pipe on Windows,
 * and gives each connection its own `docker system dial-stdio` on the server: the
 * command Docker itself uses to carry a connection over SSH, reached here through
 * nextship's own ssh so the pinned host key still applies. No port is opened on
 * either machine.
 *
 * A named pipe Node creates takes Windows' default permissions for one: full
 * control for the user who made it, SYSTEM and Administrators, and read only for
 * everyone else, who therefore cannot send the daemon a request. Read from a pipe
 * this module made, on Windows 11.
 *
 * Author: Gowtham
 * Design: ../../../../../docs/design.md §9.3
 */

import { randomBytes } from 'node:crypto'
import type { ChildProcessByStdio } from 'node:child_process'
import { createServer, type Socket } from 'node:net'
import type { Readable, Writable } from 'node:stream'
import { NextshipError } from '../../errors.js'

/** The process that carries one connection: bytes in on stdin, bytes back on stdout. */
export type Dialled = ChildProcessByStdio<Writable, Readable, null>

/** ssh's own exit code when the connection failed, as opposed to the remote command's. */
const SSH_FAILED = 255

export interface DockerBridge {
  /** Whether a connection ended because ssh lost the server, rather than because Docker was done with it. */
  lost(): boolean
  /** Stops listening and ends every connection still open. */
  close(): Promise<void>
}

/** A pipe name nobody else is using, and the `DOCKER_HOST` that reaches it. */
export function windowsPipe(): { path: string; dockerHost: string } {
  const name = `nextship-docker-${randomBytes(16).toString('hex')}`
  return { path: `\\\\.\\pipe\\${name}`, dockerHost: `npipe:////./pipe/${name}` }
}

/**
 * Listens on `path` and carries each connection over the process `dial` starts,
 * bytes in to its stdin and its stdout back out.
 */
export async function openDockerBridge(path: string, dial: () => Dialled): Promise<DockerBridge> {
  const open = new Set<{ socket: Socket; child: Dialled }>()
  let lost = false

  // Half-open, so that a client closing its sending side to say a request is
  // complete can still read the answer, where the address supports that. A Windows
  // named pipe does not, and Docker's client there never asks for it.
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    const child = dial()
    const connection = { socket, child }
    open.add(connection)
    socket.pipe(child.stdin)
    child.stdout.pipe(socket, { end: false })
    // The process's last output is sent before the client is let go. Its exit is
    // not waited for: on Windows the process's `close` never comes while the client
    // still holds the pipe that feeds its stdin.
    child.stdout.on('end', () => socket.end(() => socket.destroy()))
    // The client going away ends the process, and with it the command on the server.
    socket.on('error', () => child.kill())
    socket.on('close', () => child.kill())
    child.stdin.on('error', () => {})
    child.on('error', () => {
      lost = true
      open.delete(connection)
      socket.destroy()
    })
    child.on('exit', (code) => {
      if (code === SSH_FAILED) lost = true
      open.delete(connection)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', (error) =>
      reject(new NextshipError(`Could not open a local address for the server's Docker: ${error.message}`, 'Check the message above, or build here with `--build local`.'))
    )
    server.listen(path, resolve)
  })

  return {
    lost: () => lost,
    close: async () => {
      for (const { socket, child } of open) {
        child.kill()
        socket.destroy()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
