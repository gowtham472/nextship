/**
 * @nextship/cli: the bridge between a local address and a dialled process
 *
 * The bridge is tested with stand-ins for `ssh ... docker system dial-stdio`: a
 * process that echoes, one that answers after the request is complete, and one that
 * exits the way ssh does when it loses the server. The address is a named pipe on
 * Windows and a socket file elsewhere, so the same tests run on every platform CI
 * has. That the real Docker client builds through it is in `docs/design.md` §9.3.
 *
 * Author: Gowtham
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { openDockerBridge, windowsPipe, type Dialled } from './docker-bridge.js'

/** A stand-in for the dialled ssh: Node running one line. */
const stand = (script: string) => (): Dialled => spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'ignore'] })

const ECHO = 'process.stdin.pipe(process.stdout)'
/** Answers only once the request is complete, as an HTTP exchange over a hijacked connection does. */
const ANSWER_AT_END = "let n = 0; process.stdin.on('data', (c) => (n += c.length)); process.stdin.on('end', () => process.stdout.write('got ' + n))"
const SSH_LOST_SERVER = 'process.exit(255)'
const COMMAND_FAILED = 'process.exit(1)'

/** An address to listen on, and what removes it afterwards. */
function address(): { path: string; remove: () => void } {
  if (process.platform === 'win32') return { path: windowsPipe().path, remove: () => {} }
  const directory = mkdtempSync(path.join(tmpdir(), 'nextship-bridge-'))
  return { path: path.join(directory, 'docker.sock'), remove: () => rmSync(directory, { recursive: true, force: true }) }
}

function client(target: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path: target, allowHalfOpen: true })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

/** Everything the socket receives until the other side is done sending. */
function received(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    socket.on('data', (chunk: Buffer) => (text += chunk.toString()))
    for (const event of ['end', 'close', 'error']) socket.on(event, () => resolve(text))
  })
}

/** Resolves once the socket has received exactly `expected`, then lets the connection go. */
function receives(socket: Socket, expected: string): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString()
      if (text.length >= expected.length) {
        socket.destroy()
        resolve(text)
      }
    })
    for (const event of ['end', 'close', 'error']) socket.on(event, () => resolve(text))
  })
}

test('the pipe name is unguessable and matches the DOCKER_HOST that reaches it', () => {
  const first = windowsPipe()
  const second = windowsPipe()
  assert.match(first.path, /^\\\\\.\\pipe\\nextship-docker-[0-9a-f]{32}$/)
  assert.equal(first.dockerHost, `npipe:////./pipe/${first.path.split('\\').pop()}`)
  assert.notEqual(first.path, second.path)
})

test('bytes sent are carried to the dialled process and its output comes back', async () => {
  const where = address()
  const bridge = await openDockerBridge(where.path, stand(ECHO))
  try {
    const socket = await client(where.path)
    const all = receives(socket, 'GET /_ping HTTP/1.1\r\n\r\n')
    socket.write('GET /_ping HTTP/1.1\r\n\r\n')
    assert.equal(await all, 'GET /_ping HTTP/1.1\r\n\r\n')
    assert.equal(bridge.lost(), false)
  } finally {
    await bridge.close()
    where.remove()
  }
})

// A Windows named pipe cannot close one direction and keep the other, and Docker's
// client there never asks it to, so this holds only where the address is a socket.
test('closing the sending side completes the request without cutting off the answer', { skip: process.platform === 'win32' }, async () => {
  const where = address()
  const bridge = await openDockerBridge(where.path, stand(ANSWER_AT_END))
  try {
    const socket = await client(where.path)
    const all = received(socket)
    socket.write('12345')
    socket.end('67890')
    assert.equal(await all, 'got 10')
  } finally {
    await bridge.close()
    where.remove()
  }
})

test('every connection gets a process of its own', async () => {
  const where = address()
  let dialled = 0
  const bridge = await openDockerBridge(where.path, () => {
    dialled += 1
    return stand(ECHO)()
  })
  try {
    const sockets = await Promise.all([client(where.path), client(where.path), client(where.path)])
    const answers = sockets.map((socket, index) => receives(socket, `connection ${index}`))
    sockets.forEach((socket, index) => socket.write(`connection ${index}`))
    assert.deepEqual(await Promise.all(answers), ['connection 0', 'connection 1', 'connection 2'])
    assert.equal(dialled, 3)
  } finally {
    await bridge.close()
    where.remove()
  }
})

test("ssh's own failure code marks the connection as lost, and closes the client", async () => {
  const where = address()
  const bridge = await openDockerBridge(where.path, stand(SSH_LOST_SERVER))
  try {
    const socket = await client(where.path)
    assert.equal(await received(socket), '')
    // The client is let go when the process's output ends, which can be a moment
    // before its exit code is known. A build asks only after it has failed.
    for (let waited = 0; waited < 2000 && !bridge.lost(); waited += 10) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(bridge.lost(), true)
  } finally {
    await bridge.close()
    where.remove()
  }
})

test('a remote command that fails is not a lost connection', async () => {
  const where = address()
  const bridge = await openDockerBridge(where.path, stand(COMMAND_FAILED))
  try {
    const socket = await client(where.path)
    await received(socket)
    // Long enough for the exit code to have arrived, so this is not passing early.
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(bridge.lost(), false)
  } finally {
    await bridge.close()
    where.remove()
  }
})

test('close ends connections still open and stops listening', async () => {
  const where = address()
  const bridge = await openDockerBridge(where.path, stand(ECHO))
  try {
    const socket = await client(where.path)
    const echoed = new Promise((resolve) => socket.once('data', resolve))
    const all = received(socket)
    socket.write('still open')
    await echoed
    await bridge.close()
    await all
    assert.equal(bridge.lost(), false, 'a process this side stopped is not a lost connection')
    await assert.rejects(client(where.path))
  } finally {
    where.remove()
  }
})

test('an address that cannot be listened on is an error with a next action', async () => {
  const where = address()
  const first = await openDockerBridge(where.path, stand(ECHO))
  try {
    await assert.rejects(openDockerBridge(where.path, stand(ECHO)), (error: unknown) => {
      assert.match((error as Error).message, /Could not open a local address for the server's Docker/)
      assert.match((error as { action: string }).action, /--build local/)
      return true
    })
  } finally {
    await first.close()
    where.remove()
  }
})
