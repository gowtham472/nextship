/**
 * @nextship/cli: when a failed build is built again
 *
 * The case being guarded is narrow on purpose. A build whose connection to the server's
 * Docker dropped is built once more; a build that failed on its own merits never is,
 * because that doubles the wait before the same error. Each test pins one side of that
 * line, and every test checks each builder opened is closed.
 *
 * Author: Gowtham
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildWithReconnect, RECONNECT_NOTICE } from './build-attempts.js'
import type { ImageBuilder } from './targets/target.js'
import { NextshipError } from './errors.js'
import { CommandError } from './util/exec.js'

/** Builders that remember being closed, and answer lostConnection as told, if at all. */
function builders(answers: Array<boolean | undefined>) {
  const opened: Array<ImageBuilder & { closed: number }> = []
  const open = async (): Promise<ImageBuilder> => {
    const answer = answers[opened.length]
    const builder: ImageBuilder & { closed: number } = {
      dockerHost: `unix:///tmp/forward-${opened.length}.sock`,
      cacheScope: null,
      warning: null,
      closed: 0,
      close: async () => {
        builder.closed++
      },
    }
    if (answer !== undefined) builder.lostConnection = async () => answer
    opened.push(builder)
    return builder
  }
  return { open, opened }
}

const buildFailed = () => new CommandError('docker build --target manifest .', 1)

test('a build that succeeds runs once and closes its builder', async () => {
  const { open, opened } = builders([true])
  let attempts = 0
  const result = await buildWithReconnect(open, async () => ++attempts, () => assert.fail('no retry expected'))
  assert.equal(result, 1)
  assert.equal(attempts, 1)
  assert.deepEqual(opened.map((b) => b.closed), [1])
})

test('a build whose connection dropped is built once more, on a new builder', async () => {
  const { open, opened } = builders([true, true])
  const notices: string[] = []
  const hosts: string[] = []
  const result = await buildWithReconnect(
    open,
    async (builder) => {
      hosts.push(builder.dockerHost ?? '')
      if (hosts.length === 1) throw buildFailed()
      return 'image'
    },
    (notice) => notices.push(notice)
  )
  assert.equal(result, 'image')
  assert.deepEqual(notices, [RECONNECT_NOTICE])
  assert.notEqual(hosts[0], hosts[1], 'the second attempt uses a new connection')
  assert.deepEqual(opened.map((b) => b.closed), [1, 1])
})

test('a build that failed on its own merits is not built again', async () => {
  const { open, opened } = builders([false])
  let attempts = 0
  await assert.rejects(
    buildWithReconnect(
      open,
      async () => {
        attempts++
        throw buildFailed()
      },
      () => assert.fail('a compile error must not be retried')
    ),
    CommandError
  )
  assert.equal(attempts, 1)
  assert.deepEqual(opened.map((b) => b.closed), [1])
})

test('a builder that cannot ask its daemon never retries', async () => {
  const { open, opened } = builders([undefined])
  await assert.rejects(
    buildWithReconnect(open, async () => Promise.reject(buildFailed()), () => assert.fail('no retry expected')),
    CommandError
  )
  assert.deepEqual(opened.map((b) => b.closed), [1])
})

test('only a failed docker command can be a lost connection', async () => {
  let asked = false
  const { open } = builders([true])
  const wrapped = async () => {
    const builder = await open()
    builder.lostConnection = async () => {
      asked = true
      return true
    }
    return builder
  }
  const refusal = new NextshipError('The build ran, but the adapter did not apply the deployment id.', 'Report it.')
  await assert.rejects(buildWithReconnect(wrapped, async () => Promise.reject(refusal), () => assert.fail()), refusal)
  assert.equal(asked, false, 'an error nextship raised itself says nothing about the connection')
})

test('a second failure is reported, and there is no third attempt', async () => {
  const { open, opened } = builders([true, true])
  let attempts = 0
  const notices: string[] = []
  await assert.rejects(
    buildWithReconnect(
      open,
      async () => {
        attempts++
        throw buildFailed()
      },
      (notice) => notices.push(notice)
    ),
    CommandError
  )
  assert.equal(attempts, 2)
  assert.equal(notices.length, 1)
  assert.deepEqual(opened.map((b) => b.closed), [1, 1])
})
